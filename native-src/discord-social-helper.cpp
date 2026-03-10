#include <cdiscord.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <queue>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

struct TokenRecord {
    bool valid = false;
    int tokenType = Discord_AuthorizationTokenType_Bearer;
    std::string accessToken;
    std::string refreshToken;
    std::string scopes;
    long long expiresAtMs = 0;
};

struct PresenceAssets {
    std::string largeImageKey;
    std::string largeImageText;
    std::string smallImageKeyPlaying;
    std::string smallImageKeyPaused;
    std::string smallImageKeyBuffering;
};

struct PresencePayload {
    bool hasPresence = false;
    std::string title;
    std::string artist;
    std::string album;
    std::string provider;
    std::string buttonUrl;
    std::string artworkUrl;
    std::string status;
    std::string partyId;
    std::string joinSecret;
    long long currentTimeMs = 0;
    long long durationMs = 0;
    int partySize = 0;
    int partyMax = 0;
};

struct HelperState {
    Discord_Client client {};
    bool clientInitialised = false;
    uint64_t applicationId = 0;
    int32_t gameWindowPid = 0;
    std::string tokenFilePath;
    std::string logFilePath;
    std::string launchCommand;
    std::string defaultSocialScopes;
    std::string authCodeVerifier;
    PresenceAssets assets;
    PresencePayload presence;
    TokenRecord token;
    std::mutex outputMutex;
    std::mutex commandMutex;
    std::queue<std::vector<std::string>> commandQueue;
    std::atomic<bool> running { true };
    bool authenticated = false;
    bool ready = false;
    bool authInProgress = false;
    bool tokenRefreshInFlight = false;
    bool launchCommandRegistered = false;
};

HelperState* gState = nullptr;

void appendLog(const std::string& message) {
    if (!gState || gState->logFilePath.empty()) {
        return;
    }

    std::error_code error;
    std::filesystem::create_directories(std::filesystem::path(gState->logFilePath).parent_path(), error);

    std::ofstream stream(gState->logFilePath, std::ios::app);
    if (!stream.is_open()) {
        return;
    }

    stream << message << '\n';
}

Discord_String makeDiscordString(const std::string& value) {
    return Discord_String {
        reinterpret_cast<uint8_t*>(const_cast<char*>(value.data())),
        value.size()
    };
}

std::string fromDiscordString(const Discord_String& value) {
    if (!value.ptr || value.size == 0) {
        return "";
    }

    return std::string(reinterpret_cast<const char*>(value.ptr), value.size);
}

std::string escapeJson(const std::string& value) {
    std::string escaped;
    escaped.reserve(value.size() + 16);

    for (const char character : value) {
        switch (character) {
        case '\\':
            escaped += "\\\\";
            break;
        case '"':
            escaped += "\\\"";
            break;
        case '\b':
            escaped += "\\b";
            break;
        case '\f':
            escaped += "\\f";
            break;
        case '\n':
            escaped += "\\n";
            break;
        case '\r':
            escaped += "\\r";
            break;
        case '\t':
            escaped += "\\t";
            break;
        default:
            if (static_cast<unsigned char>(character) < 0x20) {
                std::ostringstream builder;
                builder << "\\u"
                        << std::hex
                        << std::setw(4)
                        << std::setfill('0')
                        << static_cast<int>(static_cast<unsigned char>(character));
                escaped += builder.str();
            } else {
                escaped += character;
            }
            break;
        }
    }

    return escaped;
}

void emitLine(const std::string& line) {
    std::lock_guard<std::mutex> lock(gState->outputMutex);
    std::cout << line << std::endl;
}

std::string clientResultMessage(Discord_ClientResult* result) {
    if (!result) {
        return "";
    }

    Discord_String message {};
    Discord_ClientResult_Error(result, &message);
    const std::string error = fromDiscordString(message);
    if (!error.empty()) {
        return error;
    }

    Discord_String fallback {};
    Discord_ClientResult_ToString(result, &fallback);
    return fromDiscordString(fallback);
}

void emitState(const std::string& message) {
    appendLog("[state] auth="
        + std::string(gState->authenticated ? "true" : "false")
        + " ready="
        + std::string(gState->ready ? "true" : "false")
        + " in_progress="
        + std::string(gState->authInProgress ? "true" : "false")
        + " message="
        + message);

    const std::string line =
        "{\"type\":\"state\",\"authenticated\":"
        + std::string(gState->authenticated ? "true" : "false")
        + ",\"ready\":"
        + std::string(gState->ready ? "true" : "false")
        + ",\"authInProgress\":"
        + std::string(gState->authInProgress ? "true" : "false")
        + ",\"message\":\""
        + escapeJson(message)
        + "\"}";

    emitLine(line);
}

void emitSdkLog(const std::string& message) {
    if (message.empty()) {
        return;
    }

    appendLog("[sdk] " + message);
    std::cerr << "[discord-social-sdk] " << message << std::endl;
}

void emitJoinSecret(const std::string& joinSecret) {
    emitLine(
        "{\"type\":\"activity-join\",\"secret\":\""
        + escapeJson(joinSecret)
        + "\"}"
    );
}

std::string base64Decode(const std::string& encoded) {
    static const std::string alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::vector<int> lookup(256, -1);
    for (size_t index = 0; index < alphabet.size(); index += 1) {
        lookup[static_cast<unsigned char>(alphabet[index])] = static_cast<int>(index);
    }

    std::string decoded;
    int value = 0;
    int bits = -8;

    for (const unsigned char character : encoded) {
        if (character == '=') {
            break;
        }

        const int mapped = lookup[character];
        if (mapped < 0) {
            continue;
        }

        value = (value << 6) + mapped;
        bits += 6;

        if (bits >= 0) {
            decoded.push_back(static_cast<char>((value >> bits) & 0xFF));
            bits -= 8;
        }
    }

    return decoded;
}

std::vector<std::string> splitTabs(const std::string& line) {
    std::vector<std::string> parts;
    size_t start = 0;

    while (start <= line.size()) {
        const size_t separator = line.find('\t', start);
        if (separator == std::string::npos) {
            parts.push_back(line.substr(start));
            break;
        }

        parts.push_back(line.substr(start, separator - start));
        start = separator + 1;
    }

    return parts;
}

std::string combineScopes(const std::string& left, const std::string& right) {
    std::vector<std::string> parts;

    const auto appendParts = [&parts](const std::string& value) {
        std::stringstream stream(value);
        std::string part;
        while (stream >> part) {
            if (std::find(parts.begin(), parts.end(), part) == parts.end()) {
                parts.push_back(part);
            }
        }
    };

    appendParts(left);
    appendParts(right);

    std::ostringstream builder;
    for (size_t index = 0; index < parts.size(); index += 1) {
        if (index > 0) {
            builder << ' ';
        }
        builder << parts[index];
    }

    return builder.str();
}

long long nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()
    ).count();
}

std::string trimmedText(const std::string& value, size_t maxLength) {
    if (value.empty()) {
        return "";
    }

    const size_t start = value.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) {
        return "";
    }

    const size_t end = value.find_last_not_of(" \t\r\n");
    return value.substr(start, std::min(maxLength, end - start + 1));
}

std::optional<std::string> optionalActivityField(
    const std::string& value,
    size_t minLength,
    size_t maxLength
) {
    const std::string trimmed = trimmedText(value, maxLength);
    if (trimmed.size() < minLength || trimmed.size() > maxLength) {
        return std::nullopt;
    }

    return trimmed;
}

bool looksLikeSupportedButtonUrl(const std::string& value) {
    return value.rfind("https://", 0) == 0
        || value.rfind("http://", 0) == 0;
}

bool looksLikeSupportedImageUrl(const std::string& value) {
    return looksLikeSupportedButtonUrl(value);
}

bool tokenIsUsable(const TokenRecord& token) {
    return token.valid && !token.accessToken.empty() && token.expiresAtMs > nowMs() + 60'000;
}

bool tokenHasRefresh(const TokenRecord& token) {
    return token.valid && !token.refreshToken.empty();
}

bool tokenScopesSatisfyRequired(const TokenRecord& token, const std::string& requiredScopes) {
    if (!token.valid || requiredScopes.empty()) {
        return true;
    }

    std::vector<std::string> tokenParts;
    std::stringstream tokenStream(token.scopes);
    std::string tokenPart;
    while (tokenStream >> tokenPart) {
        tokenParts.push_back(tokenPart);
    }

    std::stringstream requiredStream(requiredScopes);
    std::string requiredPart;
    while (requiredStream >> requiredPart) {
        if (std::find(tokenParts.begin(), tokenParts.end(), requiredPart) == tokenParts.end()) {
            return false;
        }
    }

    return true;
}

TokenRecord loadToken() {
    TokenRecord record;
    if (gState->tokenFilePath.empty()) {
        return record;
    }

    std::ifstream stream(gState->tokenFilePath);
    if (!stream.is_open()) {
        return record;
    }

    std::string line;
    while (std::getline(stream, line)) {
        const size_t separator = line.find('=');
        if (separator == std::string::npos) {
            continue;
        }

        const std::string key = line.substr(0, separator);
        const std::string value = line.substr(separator + 1);

        if (key == "tokenType") {
            record.tokenType = std::stoi(value);
        } else if (key == "accessToken") {
            record.accessToken = value;
        } else if (key == "refreshToken") {
            record.refreshToken = value;
        } else if (key == "scopes") {
            record.scopes = value;
        } else if (key == "expiresAtMs") {
            record.expiresAtMs = std::stoll(value);
        }
    }

    record.valid = !record.accessToken.empty();
    return record;
}

void saveToken(const TokenRecord& record) {
    if (gState->tokenFilePath.empty()) {
        return;
    }

    std::filesystem::create_directories(std::filesystem::path(gState->tokenFilePath).parent_path());

    std::ofstream stream(gState->tokenFilePath, std::ios::trunc);
    if (!stream.is_open()) {
        return;
    }

    stream
        << "tokenType=" << record.tokenType << '\n'
        << "accessToken=" << record.accessToken << '\n'
        << "refreshToken=" << record.refreshToken << '\n'
        << "scopes=" << record.scopes << '\n'
        << "expiresAtMs=" << record.expiresAtMs << '\n';
}

void clearStoredToken() {
    gState->token = TokenRecord {};
    if (!gState->tokenFilePath.empty()) {
        std::error_code error;
        std::filesystem::remove(gState->tokenFilePath, error);
    }
}

void connectClient() {
    if (!gState->authenticated) {
        return;
    }

    const Discord_Client_Status status = Discord_Client_GetStatus(&gState->client);
    if (status == Discord_Client_Status_Connected || status == Discord_Client_Status_Connecting
        || status == Discord_Client_Status_Ready || status == Discord_Client_Status_Reconnecting) {
        return;
    }

    Discord_Client_Connect(&gState->client);
}

void registerLaunchCommand() {
    if (gState->launchCommandRegistered || gState->launchCommand.empty()) {
        return;
    }

    gState->launchCommandRegistered =
        Discord_Client_RegisterLaunchCommand(
            &gState->client,
            gState->applicationId,
            makeDiscordString(gState->launchCommand)
        );

    appendLog(
        std::string("[startup] register_launch_command=")
        + (gState->launchCommandRegistered ? "ok" : "failed")
    );
}

void applyPresence();
void refreshToken();

void onActivityJoin(Discord_String joinSecret, void*) {
    emitJoinSecret(fromDiscordString(joinSecret));
}

void onSdkLog(Discord_String message, Discord_LoggingSeverity, void*) {
    emitSdkLog(fromDiscordString(message));
}

void onPresenceUpdated(Discord_ClientResult* result, void*) {
    if (!result) {
        appendLog("[presence] update callback missing result");
        return;
    }

    const bool success = Discord_ClientResult_Successful(result);
    appendLog(
        std::string("[presence] update ")
        + (success ? "ok" : "failed")
        + " message="
        + clientResultMessage(result)
    );
}

void onStatusChanged(Discord_Client_Status status, Discord_Client_Error error, int32_t errorDetail, void*) {
    Discord_String statusText {};
    Discord_Client_StatusToString(status, &statusText);

    Discord_String errorText {};
    Discord_Client_ErrorToString(error, &errorText);

    appendLog(
        "[status] status=" + fromDiscordString(statusText)
        + " error=" + fromDiscordString(errorText)
        + " detail=" + std::to_string(errorDetail)
    );

    std::string message = "Discord status changed.";

    if (status == Discord_Client_Status_Ready) {
        gState->ready = true;
        gState->authenticated = Discord_Client_IsAuthenticated(&gState->client);
        gState->authInProgress = false;
        registerLaunchCommand();
        message = "Discord connected.";
        emitState(message);
        applyPresence();
        return;
    }

    if (status == Discord_Client_Status_Disconnected) {
        gState->ready = false;
        gState->authInProgress = false;
        message = gState->authenticated ? "Discord disconnected." : "Discord not connected.";
        emitState(message);
        return;
    }

    if (status == Discord_Client_Status_Connecting) {
        gState->ready = false;
        message = "Connecting to Discord...";
        emitState(message);
        return;
    }

    if (status == Discord_Client_Status_Reconnecting) {
        gState->ready = false;
        message = "Reconnecting to Discord...";
        emitState(message);
        return;
    }

    if (status == Discord_Client_Status_Connected) {
        gState->ready = false;
        message = "Discord transport connected. Finishing setup...";
    }

    emitState(message);
}

void onTokenUpdated(Discord_ClientResult* result, void*) {
    if (!Discord_ClientResult_Successful(result)) {
        gState->authenticated = false;
        gState->ready = false;
        emitState("Discord token rejected. " + clientResultMessage(result));
        clearStoredToken();
        return;
    }

    gState->authenticated = true;
    emitState("Discord account connected.");
    connectClient();
}

void updateTokenRecord(
    Discord_String accessToken,
    Discord_String refreshToken,
    Discord_AuthorizationTokenType tokenType,
    int32_t expiresIn,
    Discord_String scopes
) {
    gState->token.valid = true;
    gState->token.accessToken = fromDiscordString(accessToken);
    gState->token.refreshToken = fromDiscordString(refreshToken);
    gState->token.tokenType = tokenType;
    gState->token.scopes = fromDiscordString(scopes);
    gState->token.expiresAtMs = nowMs() + static_cast<long long>(expiresIn) * 1000;
    saveToken(gState->token);
}

void beginUpdateToken(const TokenRecord& token) {
    if (token.accessToken.empty()) {
        return;
    }

    Discord_Client_UpdateToken(
        &gState->client,
        static_cast<Discord_AuthorizationTokenType>(token.tokenType),
        makeDiscordString(token.accessToken),
        onTokenUpdated,
        nullptr,
        nullptr
    );
}

void onTokenExchange(
    Discord_ClientResult* result,
    Discord_String accessToken,
    Discord_String refreshToken,
    Discord_AuthorizationTokenType tokenType,
    int32_t expiresIn,
    Discord_String scopes,
    void*
) {
    gState->tokenRefreshInFlight = false;

    if (!Discord_ClientResult_Successful(result)) {
        gState->authInProgress = false;
        gState->authenticated = false;
        emitState("Discord authorization failed. " + clientResultMessage(result));
        return;
    }

    updateTokenRecord(accessToken, refreshToken, tokenType, expiresIn, scopes);
    beginUpdateToken(gState->token);
}

void refreshToken() {
    if (gState->tokenRefreshInFlight || !tokenHasRefresh(gState->token)) {
        return;
    }

    gState->tokenRefreshInFlight = true;
    Discord_Client_RefreshToken(
        &gState->client,
        gState->applicationId,
        makeDiscordString(gState->token.refreshToken),
        onTokenExchange,
        nullptr,
        nullptr
    );
}

void onTokenExpired(void*) {
    refreshToken();
}

void onAuthorizationComplete(
    Discord_ClientResult* result,
    Discord_String code,
    Discord_String redirectUri,
    void*
) {
    if (!Discord_ClientResult_Successful(result)) {
        gState->authInProgress = false;
        emitState("Discord authorization was cancelled.");
        return;
    }

    Discord_Client_GetToken(
        &gState->client,
        gState->applicationId,
        code,
        makeDiscordString(gState->authCodeVerifier),
        redirectUri,
        onTokenExchange,
        nullptr,
        nullptr
    );
}

void startAuthorization() {
    if (gState->authInProgress || gState->authenticated) {
        emitState("Discord is already connected.");
        return;
    }

    gState->authInProgress = true;
    emitState("Complete Discord sign-in in the browser window that opens.");
    appendLog("[auth] starting desktop authorization");

    Discord_AuthorizationCodeVerifier verifier {};
    Discord_Client_CreateAuthorizationCodeVerifier(&gState->client, &verifier);

    Discord_String verifierValue {};
    Discord_AuthorizationCodeVerifier_Verifier(&verifier, &verifierValue);
    gState->authCodeVerifier = fromDiscordString(verifierValue);

    Discord_AuthorizationCodeChallenge challenge {};
    Discord_AuthorizationCodeVerifier_Challenge(&verifier, &challenge);

    Discord_AuthorizationArgs args {};
    Discord_AuthorizationArgs_Init(&args);
    Discord_AuthorizationArgs_SetClientId(&args, gState->applicationId);
    Discord_AuthorizationArgs_SetScopes(&args, makeDiscordString(gState->defaultSocialScopes));

    Discord_IntegrationType integrationType = Discord_IntegrationType_UserInstall;
    Discord_AuthorizationArgs_SetIntegrationType(&args, &integrationType);
    Discord_AuthorizationArgs_SetCodeChallenge(&args, &challenge);

    Discord_Client_Authorize(
        &gState->client,
        &args,
        onAuthorizationComplete,
        nullptr,
        nullptr
    );

    Discord_AuthorizationArgs_Drop(&args);
    Discord_AuthorizationCodeChallenge_Drop(&challenge);
    Discord_AuthorizationCodeVerifier_Drop(&verifier);
}

std::string presenceDetailsText(const PresencePayload& payload) {
    if (!payload.artist.empty()) {
        return payload.artist;
    }

    if (!payload.album.empty()) {
        return payload.album;
    }

    return payload.provider;
}

std::string presenceStateText(const PresencePayload& payload) {
    return "";
}

void applyPresence() {
    if (!gState->clientInitialised) {
        return;
    }

    if (!gState->presence.hasPresence) {
        Discord_Client_ClearRichPresence(&gState->client);
        return;
    }

    Discord_Activity activity {};
    Discord_Activity_Init(&activity);
    Discord_Activity_SetType(&activity, Discord_ActivityTypes_Listening);

    const auto nameField = optionalActivityField(gState->presence.title, 2, 128);
    if (nameField.has_value()) {
        Discord_Activity_SetName(&activity, makeDiscordString(*nameField));
    }

    const auto detailsField = optionalActivityField(presenceDetailsText(gState->presence), 2, 128);
    if (detailsField.has_value()) {
        Discord_String details = makeDiscordString(*detailsField);
        Discord_Activity_SetDetails(&activity, &details);
    }

    const auto stateField = optionalActivityField(presenceStateText(gState->presence), 2, 128);
    if (stateField.has_value()) {
        Discord_String stateValue = makeDiscordString(*stateField);
        Discord_Activity_SetState(&activity, &stateValue);
    }

    Discord_ActivityAssets assets {};
    Discord_ActivityAssets_Init(&assets);
    bool hasAssets = false;
    const std::string artworkUrl = trimmedText(gState->presence.artworkUrl, 512);
    const auto largeImageTextField = optionalActivityField(
        gState->presence.artist.empty()
            ? gState->presence.title
            : gState->presence.title + " | " + gState->presence.artist,
        2,
        128
    );

    if (!artworkUrl.empty() && looksLikeSupportedImageUrl(artworkUrl)) {
        Discord_String artworkImage = makeDiscordString(artworkUrl);
        Discord_String inviteCoverImage = makeDiscordString(artworkUrl);
        Discord_ActivityAssets_SetLargeImage(&assets, &artworkImage);
        Discord_ActivityAssets_SetInviteCoverImage(&assets, &inviteCoverImage);
        hasAssets = true;
    } else if (!gState->assets.largeImageKey.empty()) {
        Discord_String largeImage = makeDiscordString(gState->assets.largeImageKey);
        Discord_ActivityAssets_SetLargeImage(&assets, &largeImage);
        hasAssets = true;
    }

    const std::string largeImageText =
        largeImageTextField.has_value()
            ? *largeImageTextField
            : gState->assets.largeImageText;

    if (!largeImageText.empty()) {
        Discord_String largeText = makeDiscordString(largeImageText);
        Discord_ActivityAssets_SetLargeText(&assets, &largeText);
        hasAssets = true;
    }

    const std::string smallImageKey =
        gState->presence.status == "buffering"
            ? gState->assets.smallImageKeyBuffering
            : gState->presence.status == "paused"
                ? gState->assets.smallImageKeyPaused
                : gState->assets.smallImageKeyPlaying;

    if (!smallImageKey.empty()) {
        Discord_String smallImage = makeDiscordString(smallImageKey);
        Discord_ActivityAssets_SetSmallImage(&assets, &smallImage);
        hasAssets = true;
    }

    if (hasAssets) {
        Discord_Activity_SetAssets(&activity, &assets);
    }

    Discord_ActivityTimestamps timestamps {};
    Discord_ActivityTimestamps_Init(&timestamps);
    if (gState->presence.status == "playing" && gState->presence.durationMs > 0) {
        const uint64_t currentTime = static_cast<uint64_t>(std::max<long long>(0, gState->presence.currentTimeMs));
        const uint64_t remaining = static_cast<uint64_t>(
            std::max<long long>(0, gState->presence.durationMs - gState->presence.currentTimeMs)
        );
        Discord_ActivityTimestamps_SetStart(&timestamps, static_cast<uint64_t>(nowMs()) - currentTime);
        Discord_ActivityTimestamps_SetEnd(&timestamps, static_cast<uint64_t>(nowMs()) + remaining);
        Discord_Activity_SetTimestamps(&activity, &timestamps);
    }

    Discord_ActivityParty party {};
    Discord_ActivityParty_Init(&party);
    const auto partyIdField = optionalActivityField(gState->presence.partyId, 2, 128);
    if (partyIdField.has_value() && gState->presence.partyMax > 0) {
        Discord_ActivityParty_SetId(&party, makeDiscordString(*partyIdField));
        Discord_ActivityParty_SetCurrentSize(&party, std::max(1, gState->presence.partySize));
        Discord_ActivityParty_SetMaxSize(&party, std::max(gState->presence.partyMax, std::max(1, gState->presence.partySize)));
        Discord_ActivityParty_SetPrivacy(&party, Discord_ActivityPartyPrivacy_Public);
        Discord_Activity_SetParty(&activity, &party);
    }

    Discord_ActivitySecrets secrets {};
    Discord_ActivitySecrets_Init(&secrets);
    const auto joinSecretField = optionalActivityField(gState->presence.joinSecret, 2, 128);
    if (joinSecretField.has_value() && partyIdField.has_value()) {
        Discord_ActivitySecrets_SetJoin(&secrets, makeDiscordString(*joinSecretField));
        Discord_Activity_SetSecrets(&activity, &secrets);
    }

    const std::string buttonUrl = trimmedText(gState->presence.buttonUrl, 256);
    if (!buttonUrl.empty() && looksLikeSupportedButtonUrl(buttonUrl)) {
        Discord_ActivityButton button {};
        Discord_ActivityButton_Init(&button);
        Discord_ActivityButton_SetLabel(&button, makeDiscordString("Play on Apollo"));
        Discord_ActivityButton_SetUrl(&button, makeDiscordString(buttonUrl));
        Discord_Activity_AddButton(&activity, &button);
        Discord_ActivityButton_Drop(&button);
    }

    appendLog(
        "[presence] applying name_len="
        + std::to_string(nameField.has_value() ? nameField->size() : 0)
        + " details_len="
        + std::to_string(detailsField.has_value() ? detailsField->size() : 0)
        + " state_len="
        + std::to_string(stateField.has_value() ? stateField->size() : 0)
        + " party_len="
        + std::to_string(partyIdField.has_value() ? partyIdField->size() : 0)
        + " join_len="
        + std::to_string(joinSecretField.has_value() ? joinSecretField->size() : 0)
        + " artwork_len="
        + std::to_string(artworkUrl.size())
        + " button_len="
        + std::to_string(buttonUrl.size())
    );

    Discord_Client_UpdateRichPresence(&gState->client, &activity, onPresenceUpdated, nullptr, nullptr);

    Discord_ActivitySecrets_Drop(&secrets);
    Discord_ActivityParty_Drop(&party);
    Discord_ActivityTimestamps_Drop(&timestamps);
    Discord_ActivityAssets_Drop(&assets);
    Discord_Activity_Drop(&activity);
}

std::string relationshipStatus(Discord_StatusType status) {
    switch (status) {
    case Discord_StatusType_Online:
        return "online";
    case Discord_StatusType_Idle:
        return "idle";
    case Discord_StatusType_Dnd:
        return "dnd";
    case Discord_StatusType_Offline:
    case Discord_StatusType_Invisible:
        return "offline";
    default:
        return "unknown";
    }
}

void emitFriends(const std::string& requestId) {
    if (!gState->ready || !gState->authenticated) {
        emitLine(
            "{\"type\":\"friends\",\"requestId\":\"" + escapeJson(requestId)
            + "\",\"friends\":[],\"message\":\"Discord is not connected.\"}"
        );
        return;
    }

    Discord_RelationshipHandleSpan relationships {};
    Discord_Client_GetRelationships(&gState->client, &relationships);

    struct Friend {
        uint64_t id = 0;
        std::string username;
        std::string displayName;
        std::string status;
        bool playingApollo = false;
    };

    std::vector<Friend> friends;

    for (size_t index = 0; index < relationships.size; index += 1) {
        Discord_RelationshipHandle relationship {};
        Discord_RelationshipHandle_Clone(&relationship, &relationships.ptr[index]);
        if (Discord_RelationshipHandle_DiscordRelationshipType(&relationship) != Discord_RelationshipType_Friend) {
            Discord_RelationshipHandle_Drop(&relationship);
            continue;
        }

        Discord_UserHandle user {};
        if (!Discord_RelationshipHandle_User(&relationship, &user)) {
            Discord_RelationshipHandle_Drop(&relationship);
            continue;
        }

        Friend friendInfo;
        friendInfo.id = Discord_UserHandle_Id(&user);

        Discord_String username {};
        Discord_UserHandle_Username(&user, &username);
        friendInfo.username = fromDiscordString(username);

        Discord_String displayName {};
        Discord_UserHandle_DisplayName(&user, &displayName);
        friendInfo.displayName = fromDiscordString(displayName);

        friendInfo.status = relationshipStatus(Discord_UserHandle_Status(&user));

        Discord_Activity activity {};
        if (Discord_UserHandle_GameActivity(&user, &activity)) {
            uint64_t applicationId = 0;
            if (Discord_Activity_ApplicationId(&activity, &applicationId)) {
                friendInfo.playingApollo = applicationId == gState->applicationId;
            }
            Discord_Activity_Drop(&activity);
        }

        if (friendInfo.displayName.empty()) {
            friendInfo.displayName = friendInfo.username;
        }

        friends.push_back(friendInfo);

        Discord_UserHandle_Drop(&user);
        Discord_RelationshipHandle_Drop(&relationship);
    }

    std::sort(
        friends.begin(),
        friends.end(),
        [](const Friend& left, const Friend& right) {
            const auto statusRank = [](const std::string& status) {
                if (status == "online") {
                    return 0;
                }
                if (status == "idle") {
                    return 1;
                }
                if (status == "dnd") {
                    return 2;
                }
                return 3;
            };

            if (statusRank(left.status) != statusRank(right.status)) {
                return statusRank(left.status) < statusRank(right.status);
            }

            return left.displayName < right.displayName;
        }
    );

    std::ostringstream builder;
    builder << "{\"type\":\"friends\",\"requestId\":\"" << escapeJson(requestId) << "\",\"friends\":[";

    for (size_t index = 0; index < friends.size(); index += 1) {
        if (index > 0) {
            builder << ",";
        }

        builder
            << "{\"id\":\"" << friends[index].id
            << "\",\"username\":\"" << escapeJson(friends[index].username)
            << "\",\"displayName\":\"" << escapeJson(friends[index].displayName)
            << "\",\"status\":\"" << escapeJson(friends[index].status)
            << "\",\"playingApollo\":" << (friends[index].playingApollo ? "true" : "false")
            << "}";
    }

    builder << "]}";
    emitLine(builder.str());
}

void freeStringPointer(void* pointer) {
    delete static_cast<std::string*>(pointer);
}

void onInviteSent(Discord_ClientResult* result, void* userData) {
    std::unique_ptr<std::string> requestId(static_cast<std::string*>(userData));
    const bool success = Discord_ClientResult_Successful(result);

    emitLine(
        "{\"type\":\"invite-result\",\"requestId\":\""
        + escapeJson(*requestId)
        + "\",\"success\":"
        + std::string(success ? "true" : "false")
        + ",\"message\":\""
        + escapeJson(success ? "Discord invite sent." : clientResultMessage(result))
        + "\"}"
    );
}

void sendInvite(const std::string& requestId, const std::string& userId, const std::string& content) {
    if (!gState->ready || !gState->authenticated) {
        emitLine(
            "{\"type\":\"invite-result\",\"requestId\":\""
            + escapeJson(requestId)
            + "\",\"success\":false,\"message\":\"Discord is not connected.\"}"
        );
        return;
    }

    const auto parsedUserId = static_cast<uint64_t>(std::stoull(userId));
    Discord_Client_SendActivityInvite(
        &gState->client,
        parsedUserId,
        makeDiscordString(content),
        onInviteSent,
        nullptr,
        new std::string(requestId)
    );
}

void processCommand(const std::vector<std::string>& parts) {
    if (parts.empty()) {
        return;
    }

    const std::string& command = parts[0];
    appendLog("[command] " + command);

    if (command == "shutdown") {
        gState->running = false;
        return;
    }

    if (command == "start_auth") {
        startAuthorization();
        return;
    }

    if (command == "sign_out") {
        Discord_Client_ClearRichPresence(&gState->client);
        Discord_Client_Disconnect(&gState->client);
        gState->authenticated = false;
        gState->ready = false;
        gState->authInProgress = false;
        clearStoredToken();
        emitState("Discord account disconnected.");
        return;
    }

    if (command == "configure_assets" && parts.size() >= 6) {
        gState->assets.largeImageKey = base64Decode(parts[1]);
        gState->assets.largeImageText = base64Decode(parts[2]);
        gState->assets.smallImageKeyPlaying = base64Decode(parts[3]);
        gState->assets.smallImageKeyPaused = base64Decode(parts[4]);
        gState->assets.smallImageKeyBuffering = base64Decode(parts[5]);
        applyPresence();
        return;
    }

    if (command == "clear_presence") {
        gState->presence = PresencePayload {};
        applyPresence();
        return;
    }

    if (command == "set_presence" && parts.size() >= 13) {
        gState->presence.hasPresence = true;
        gState->presence.title = base64Decode(parts[1]);
        gState->presence.artist = base64Decode(parts[2]);
        gState->presence.album = base64Decode(parts[3]);
        gState->presence.provider = base64Decode(parts[4]);
        gState->presence.buttonUrl = base64Decode(parts[5]);
        gState->presence.status = parts[6];
        gState->presence.currentTimeMs = std::stoll(parts[7]);
        gState->presence.durationMs = std::stoll(parts[8]);
        gState->presence.partyId = base64Decode(parts[9]);
        gState->presence.partySize = std::stoi(parts[10]);
        gState->presence.partyMax = std::stoi(parts[11]);
        gState->presence.joinSecret = base64Decode(parts[12]);
        gState->presence.artworkUrl = parts.size() >= 14 ? base64Decode(parts[13]) : "";
        applyPresence();
        return;
    }

    if (command == "list_friends" && parts.size() >= 2) {
        emitFriends(parts[1]);
        return;
    }

    if (command == "invite" && parts.size() >= 4) {
        sendInvite(parts[1], parts[2], base64Decode(parts[3]));
    }
}

void stdinReader() {
    std::string line;
    while (gState->running && std::getline(std::cin, line)) {
        std::lock_guard<std::mutex> lock(gState->commandMutex);
        gState->commandQueue.push(splitTabs(line));
    }

    gState->running = false;
}

void initialiseClient() {
    Discord_SetFreeThreaded();
    Discord_Client_Init(&gState->client);
    gState->clientInitialised = true;
    Discord_Client_SetApplicationId(&gState->client, gState->applicationId);
    Discord_Client_SetGameWindowPid(&gState->client, gState->gameWindowPid);
    registerLaunchCommand();
    const auto logDirectory = std::filesystem::path(gState->logFilePath).parent_path().string();
    if (!logDirectory.empty()) {
        Discord_Client_SetLogDir(
            &gState->client,
            makeDiscordString(logDirectory),
            Discord_LoggingSeverity_Info
        );
    }
    Discord_Client_AddLogCallback(
        &gState->client,
        onSdkLog,
        nullptr,
        nullptr,
        Discord_LoggingSeverity_Info
    );
    Discord_Client_SetStatusChangedCallback(&gState->client, onStatusChanged, nullptr, nullptr);
    Discord_Client_SetActivityJoinCallback(&gState->client, onActivityJoin, nullptr, nullptr);
    Discord_Client_SetTokenExpirationCallback(&gState->client, onTokenExpired, nullptr, nullptr);
    Discord_String presenceScopes {};
    Discord_Client_GetDefaultPresenceScopes(&presenceScopes);
    Discord_String communicationScopes {};
    Discord_Client_GetDefaultCommunicationScopes(&communicationScopes);
    gState->defaultSocialScopes = combineScopes(
        fromDiscordString(presenceScopes),
        fromDiscordString(communicationScopes)
    );
    appendLog("[startup] scopes=" + gState->defaultSocialScopes);
}

void bootstrapAuthentication() {
    gState->token = loadToken();
    if (!tokenScopesSatisfyRequired(gState->token, gState->defaultSocialScopes)) {
        appendLog("[startup] clearing cached token because scopes are missing required social scopes");
        clearStoredToken();
    }
    if (tokenIsUsable(gState->token)) {
        beginUpdateToken(gState->token);
        return;
    }

    if (tokenHasRefresh(gState->token)) {
        refreshToken();
        return;
    }

    emitState("Connect Discord to enable invites and joinable presence.");
}

} // namespace

int main(int argc, char** argv) {
    HelperState state;
    gState = &state;

    for (int index = 1; index < argc; index += 1) {
        const std::string argument = argv[index];
        if (argument == "--app-id" && index + 1 < argc) {
            state.applicationId = static_cast<uint64_t>(std::stoull(argv[++index]));
        } else if (argument == "--token-file" && index + 1 < argc) {
            state.tokenFilePath = argv[++index];
            state.logFilePath = std::filesystem::path(state.tokenFilePath).parent_path().string() + "\\discord-social-helper.log";
        } else if (argument == "--launch-command" && index + 1 < argc) {
            state.launchCommand = argv[++index];
        } else if (argument == "--game-pid" && index + 1 < argc) {
            state.gameWindowPid = std::stoi(argv[++index]);
        }
    }

    if (!state.applicationId) {
        emitLine("{\"type\":\"fatal\",\"message\":\"Missing Discord application ID.\"}");
        return 1;
    }

    appendLog("[startup] helper launching with app_id=" + std::to_string(state.applicationId));

    initialiseClient();
    bootstrapAuthentication();

    std::thread reader(stdinReader);

    while (state.running) {
        Discord_RunCallbacks();

        std::queue<std::vector<std::string>> pending;
        {
            std::lock_guard<std::mutex> lock(state.commandMutex);
            std::swap(pending, state.commandQueue);
        }

        while (!pending.empty()) {
            processCommand(pending.front());
            pending.pop();
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }

    if (reader.joinable()) {
        reader.join();
    }

    if (state.clientInitialised) {
        Discord_Client_ClearRichPresence(&state.client);
        Discord_Client_Disconnect(&state.client);
        Discord_Client_Drop(&state.client);
    }

    return 0;
}
