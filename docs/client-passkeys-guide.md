# Переход клиента на вход по passkey (гайд для BE-22)

Гайд для `messenger-client-react`: что изменилось в контракте после BE-21 и как перевести клиент на вход по passkey (WebAuthn) с инвайтами. Источник истины по контракту — `docs/client-integration.md` (§1.3 коды ошибок, §2 аутентификация, §3.11 админка, §4 модели, §6 сценарии, §7 лимиты); он сверяется с кодом автоматически (`scripts/check-sync.mjs`). Этот файл объясняет, **как** реализовать, и ссылается на разделы спецификации; при расхождении верна спецификация.

Решения: SH-D14 (инвайты и passkeys вместо OAuth и allowlist), BE-D24–BE-D30 (`.ai/memory/decisions.md`).

## 1. Что изменилось

| Было (OAuth) | Стало (passkey) |
|---|---|
| Кнопки «Войти через Google/GitHub», полная навигация на `GET /api/auth/:provider/start` | `fetch`-запросы `POST /api/auth/passkey/login/{options,verify}` и вызов `navigator.credentials.get` (§2.1) |
| Ошибка входа — редирект на `/?auth_error=<код>` | Ошибка — JSON `{ error: { code } }` в ответе на `fetch`; параметра `auth_error` больше нет |
| Вход по аккаунту, заранее внесённому админом в allowlist | Новый пользователь приходит только по ссылке-приглашению `PUBLIC_URL/invite#<token>` (§2.7) |
| Имя и аватар из профиля провайдера | Имя вводит пользователь при регистрации; `avatarUrl` у новых пользователей `""` |
| `SessionUser.provider` | Поля нет: `user` = `{ id, name, avatarUrl }` (§2.3, §4) |
| Любой `401` — выход из системы | Выход только при `401` с кодом `unauthorized`; `401 auth_failed` — неудачная церемония, сессия жива (§2.6) |
| Админка allowlist `/api/admin/allowlist` | Админка инвайтов и пользователей `/api/admin/invites`, `/api/admin/users` (§3.11) |
| — | Раздел «Мои ключи» `/api/me/passkeys` (§2.8) |

Без изменений: cookie-сессия `sid` (7 дней), `GET /api/auth/session`, CSRF (`X-CSRF-Token` из тела сессии), `POST /api/auth/logout`, весь REST чатов и сообщений, WebSocket `/ws`.

## 2. Что убрать из клиента

- `src/app/services/authError.js` (+ тест) и чтение `auth_error` из адреса.
- `src/app/modules/login/providers.js`, `ProviderIcon.js` и ссылки `/api/auth/${id}/start` в `Login.js`.
- `/mock-provider` в `src/setupProxy.js`; OAuth-часть `mock-bff/server.js` (mock-BFF либо переводится на новый контракт, либо e2e идут против настоящего бэкенда — §9).
- Описание OAuth в `.ai/memory/auth-contract.md` клиента: заменить ссылкой на этот гайд и `docs/client-integration.md` §2.

## 3. Правка `apiClient`: какой `401` означает выход

Сейчас `apiRequest` вызывает обработчик выхода на **любой** `401`. После перехода `401 auth_failed` приходит на неудачную церемонию, в том числе в «Моих ключах» при живой сессии. Обработчик нужно вызывать только для кода `unauthorized`:

```js
// src/app/services/apiClient.js — внутри apiRequest, ветка !response.ok
const code = data && data.error && data.error.code;
if (response.status === 401 && code === "unauthorized" && !skipUnauthorizedHandler && unauthorizedHandler) {
    unauthorizedHandler();
}
throw new ApiError(response.status, data);
```

Для удобства — геттер кода в `ApiError`:

```js
export class ApiError extends Error {
    constructor(status, data) {
        super(`API error ${status}`);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
        this.code = (data && data.error && data.error.code) || null;
    }
}
```

`fetch` с того же origin сам ставит заголовок `Origin`, который требуют публичные `POST` (§1.2); ничего добавлять не нужно. CSRF-токен на публичные `POST` (вход, регистрация, `inspect`) не нужен и до входа его нет — `apiRequest` и так не ставит заголовок при `csrfToken === null`.

## 4. Сериализация WebAuthn

Сервер отдаёт опции в JSON-виде (`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`, бинарные поля в base64url) и принимает ответ аутентификатора тоже в JSON (`RegistrationResponseJSON` / `AuthenticationResponseJSON`). Есть два способа перевести их в формат браузерного API и обратно.

**Нативно (рекомендуется, без зависимостей).** Поддержка по данным MDN на момент написания: Chrome 129+, Firefox 119+, Safari 18.4+ (перед решением проверить актуальные таблицы совместимости):

```js
const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
});
const json = credential.toJSON();
```

**Запасной вариант для старых браузеров.** `browserslist` клиента шире поддержки нативных методов. Если они нужны, — либо библиотека `@simplewebauthn/browser` (новая зависимость, согласуется по правилам клиента), либо небольшой хелпер без зависимостей:

```js
// src/app/services/webauthn.js
const toBase64url = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64url = (value) => {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)).buffer;
};

const hasNativeJson = () =>
    typeof PublicKeyCredential !== "undefined" &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function";

export function creationOptionsFromJSON(options) {
    if (hasNativeJson()) return PublicKeyCredential.parseCreationOptionsFromJSON(options);
    return {
        ...options,
        challenge: fromBase64url(options.challenge),
        user: { ...options.user, id: fromBase64url(options.user.id) },
        excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: fromBase64url(c.id) })),
    };
}

export function requestOptionsFromJSON(options) {
    if (hasNativeJson()) return PublicKeyCredential.parseRequestOptionsFromJSON(options);
    return {
        ...options,
        challenge: fromBase64url(options.challenge),
        allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: fromBase64url(c.id) })),
    };
}

export function credentialToJSON(credential) {
    if (typeof credential.toJSON === "function") return credential.toJSON();
    const r = credential.response;
    const base = {
        id: credential.id,
        rawId: toBase64url(credential.rawId),
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment || undefined,
        // обязательно: сервер отклоняет credential без clientExtensionResults (400 validation_failed)
        clientExtensionResults: credential.getClientExtensionResults(),
    };
    if (r.attestationObject) {
        return {
            ...base,
            response: {
                clientDataJSON: toBase64url(r.clientDataJSON),
                attestationObject: toBase64url(r.attestationObject),
                transports: typeof r.getTransports === "function" ? r.getTransports() : [],
            },
        };
    }
    return {
        ...base,
        response: {
            clientDataJSON: toBase64url(r.clientDataJSON),
            authenticatorData: toBase64url(r.authenticatorData),
            signature: toBase64url(r.signature),
            userHandle: r.userHandle ? toBase64url(r.userHandle) : null,
        },
    };
}
```

Что проверяет сервер в теле: `credential` — объект с `id`, `rawId`, `type: "public-key"`, `clientExtensionResults` (объект) и `response` с `clientDataJSON` и `attestationObject` (регистрация) либо `authenticatorData` и `signature` (вход). Лишние поля **верхнего** уровня тела запрещены (`400 validation_failed`): отправлять ровно `{ credential }` или `{ credential, passkeyName }`.

Поддержка passkey в браузере: `window.PublicKeyCredential` существует. Если нет — показать «браузер не поддерживает вход по ключу».

## 5. Сценарии

Ниже `apiRequest` — существующая функция клиента, `webauthn.js` — хелперы из §4. Все ответы с сессией возвращают `{ user, csrfToken }`: сохранить `user` в стор и вызвать `setCsrfToken(csrfToken)` — повторный `GET /api/auth/session` не нужен.

### 5.1. Вход (§2.1)

```js
export async function loginWithPasskey() {
    const options = await apiRequest("/api/auth/passkey/login/options", { method: "POST" });
    const credential = await navigator.credentials.get({ publicKey: requestOptionsFromJSON(options) });
    const session = await apiRequest("/api/auth/passkey/login/verify", {
        method: "POST",
        body: { credential: credentialToJSON(credential) },
        skipUnauthorizedHandler: true,
    });
    setCsrfToken(session.csrfToken);
    return session.user;
}
```

- Экран входа: одна кнопка «Войти с ключом». Логин вводить не нужно — пользователя определяет ключ (браузер покажет список сохранённых ключей или QR для входа с телефона).
- Церемония одноразовая и живёт 5 минут. После любой ошибки начинать заново с `options`.

### 5.2. Регистрация по приглашению (§2.7)

Маршрут SPA `/invite`. Токен приходит во фрагменте: `https://<host>/invite#<token>`.

1. При монтировании прочитать `window.location.hash.slice(1)`, сразу убрать фрагмент: `history.replaceState(history.state, "", "/invite")`. Держать токен в состоянии компонента, не в адресе и не в `localStorage`.
2. `POST /api/invites/inspect` `{ token }` → `{ kind, expiresAt }`. `404 invite_invalid` → «Ссылка недействительна или истекла, попросите администратора выпустить новую». `400 validation_failed` (токен не 43 символа) — то же сообщение.
3. Форма:
   - `kind: "join"` — поле «Как вас зовут» (1..64 символа после `trim`) и поле «Название ключа» («iPhone», «Рабочий ноутбук»; 1..64).
   - `kind: "recovery"` — только «Название ключа» и пояснение «Будет добавлен новый ключ; все ваши текущие сеансы будут завершены».
4. Отправка:

```js
export async function registerByInvite({ token, name, passkeyName }) {
    const options = await apiRequest("/api/auth/passkey/register/options", {
        method: "POST",
        body: name === undefined ? { token } : { token, name },
    });
    const credential = await navigator.credentials.create({ publicKey: creationOptionsFromJSON(options) });
    const session = await apiRequest("/api/auth/passkey/register/verify", {
        method: "POST",
        body: { credential: credentialToJSON(credential), passkeyName },
        skipUnauthorizedHandler: true,
    });
    setCsrfToken(session.csrfToken);
    return session.user;
}
```

   Для `"recovery"` поле `name` не передавать. Токен на шаг `verify` не передаётся: сервер берёт приглашение из церемонии.
5. `201` → перейти в приложение. Ссылка после этого погашена; повторное открытие даёт `404 invite_invalid`.

### 5.3. Мои ключи (§2.8)

Нужна сессия; `apiRequest` сам добавит `X-CSRF-Token`.

- Список: `GET /api/me/passkeys` → `PasskeyItem[]` (`id`, `name`, `deviceType`, `backedUp`, `createdAt`, `lastUsedAt`). `backedUp: true` — ключ синхронизируется (iCloud, Google Password Manager); можно показать значок «синхронизирован».
- Добавить ключ: `POST /api/me/passkeys/options` → `navigator.credentials.create` → `POST /api/me/passkeys/verify` `{ credential, passkeyName }` → `201 PasskeyItem`.
  - `403 reauth_required` — сессия старше 10 минут. Показать «Для добавления ключа войдите заново» и кнопку, которая выполняет вход (§5.1) и затем повторяет добавление. Выходить из системы не обязательно: новый вход заменит текущую сессию.
  - `DOMException` с именем `InvalidStateError` при `create` — этот аутентификатор уже зарегистрирован у пользователя (`excludeCredentials`): «Этот ключ уже добавлен».
- Переименовать: `PATCH /api/me/passkeys/:id` `{ name }`.
- Удалить: `DELETE /api/me/passkeys/:id` → `204`; `409 last_passkey` — «Нельзя удалить единственный ключ: без него вы не сможете войти». Кнопку удаления у последнего ключа лучше сразу делать неактивной.

### 5.4. Админка (§3.11)

Флага админа в сессии нет (SH-D12, BE-06). Показывать раздел по ответу: `GET /api/admin/users` → `200` — админ, `403 forbidden` — скрыть раздел.

- **Пригласить:** `POST /api/admin/invites` (тело пустое) → `201 { id, kind, url, expiresAt, … }`. Показать `url` **один раз** с кнопкой «Копировать» и предупреждением, что ссылку больше не получить. Ссылку админ передаёт любым каналом.
- **Действующие приглашения:** `GET /api/admin/invites`; отозвать — `DELETE /api/admin/invites/:id` (`404` — уже использовано или истекло; обновить список).
- **Пользователи:** `GET /api/admin/users` → `AdminUserItem[]` (`isAdmin`, `disabledAt`).
  - Сделать админом / снять: `PATCH /api/admin/users/:id { isAdmin }`.
  - Отключить / включить: `PATCH /api/admin/users/:id { disabled }`. Отключение сразу завершает все сеансы пользователя.
  - Себя изменить нельзя (`403 forbidden`): у строки текущего пользователя элементы управления скрыть.
- **Восстановить доступ:** `POST /api/admin/invites { kind: "recovery", userId }` → ссылка восстановления для пользователя (показать один раз, как приглашение). Отключённого пользователя сначала включить, иначе он получит `403 user_disabled`.

## 6. Ошибки и тексты

| Где | Ответ | Что делает клиент |
|---|---|---|
| Любой запрос под сессией | `401 unauthorized` | Выход: сброс стора, экран входа (§2.6) |
| Вход, регистрация, добавление ключа | `401 auth_failed` | «Не удалось подтвердить ключ, попробуйте ещё раз»; начать церемонию заново. Не выходить из системы |
| Вход, восстановление | `403 user_disabled` | «Ваш доступ отключён администратором» |
| Приглашение | `404 invite_invalid` | «Ссылка недействительна или истекла» |
| Добавление ключа | `403 reauth_required` | «Войдите заново, чтобы добавить ключ» (§5.3) |
| Удаление ключа | `409 last_passkey` | «Нельзя удалить единственный ключ» |
| Публичные `POST` | `403 forbidden` | Ошибка конфигурации (нет `Origin` из `ALLOWED_ORIGINS`); общий текст «Не удалось войти» и лог в консоль разработчика |
| Публичные `POST` | `429 rate_limited` | «Слишком много попыток, повторите через N с» (`Retry-After`) |
| Формы | `400 validation_failed` | Проверять длины (1..64) на клиенте до отправки; `message` сервера — для отладки, не для UI |

Ошибки браузерного API (`navigator.credentials.*` бросает `DOMException`):

| `error.name` | Причина | Что делает клиент |
|---|---|---|
| `NotAllowedError` | Пользователь отменил окно, истёк таймаут или ключа для этого сайта нет | Тихо вернуть форму в исходное состояние, можно подсказку «Вход отменён» |
| `InvalidStateError` | При `create`: ключ на этом устройстве уже зарегистрирован | «Этот ключ уже добавлен» |
| `SecurityError` | Небезопасный контекст или домен не совпадает с RP ID | Ошибка конфигурации окружения (§9) |
| `AbortError` | Церемония отменена кодом (`AbortController`) | Ничего |

На сервер при ошибке браузера ничего отправлять не нужно: незавершённая церемония истечёт сама.

## 7. Поведение, которое легко упустить

- **Одна церемония за раз.** Cookie церемонии одна на браузер: вторая церемония (в другой вкладке или по двойному клику) затирает первую, и первая получит `401 auth_failed`. Блокировать кнопку на время церемонии.
- **Новый вход заменяет сессию.** После успешного `verify` старая cookie-сессия уничтожена, `csrfToken` новый (он в ответе). Открытые вкладки со старым `csrfToken` получат `403 csrf_invalid` — лечится `GET /api/auth/session` (§2.4).
- **Восстановление завершает все сеансы** пользователя: другие вкладки и устройства получат `401 unauthorized` и `4401` по WebSocket.
- **Отключение пользователя** админом — то же самое для отключённого.
- **Токен приглашения — секрет.** Не логировать, не класть в адрес после чтения, не отправлять в аналитику.
- **Имя пользователя** задаётся один раз при регистрации; эндпоинта смены имени пока нет.

## 8. Тексты и решения на стороне клиента

Тексты выше — предложение; окончательные формулировки, вид экранов, выбор между нативными методами и `@simplewebauthn/browser` — решения клиента (его `decisions.md`).

## 9. Локальная разработка

- **Бэкенд:** `PORT=3333`, `PUBLIC_URL=http://localhost:3000`, `ALLOWED_ORIGINS=http://localhost:3000` (как в `.env.example`). RP ID — `localhost`; WebAuthn разрешён на `http://localhost` без HTTPS.
- **Прокси CRA:** `/api` уже идёт на `http://localhost:3333`. Браузер ставит `Origin: http://localhost:3000`, прокси передаёт его бэкенду без изменений — этого достаточно для проверки `Origin`. Для WebSocket нужен ещё `/ws` с `ws: true` (BE-15).
- **Открывать приложение только по `http://localhost:3000`.** По `http://127.0.0.1:3000` или по адресу в локальной сети (`http://192.168.…`) браузер откажет (`SecurityError`): RP ID не совпадёт, а не-`localhost` требует HTTPS. Для проверки с телефона нужен HTTPS-домен и соответствующий `PUBLIC_URL`.
- **Первый пользователь:** на бэкенде `npm run build && npm run admin:invite` печатает ссылку-приглашение администратора; открыть её в браузере и зарегистрировать ключ. Дальнейших пользователей приглашает админ из UI.
- **Ключ без устройства:** в Chrome DevTools → More tools → WebAuthn → «Enable virtual authenticator environment», протокол `ctap2`, «Supports resident keys» и «Supports user verification» включены.
- **e2e (Playwright):** виртуальный аутентификатор через CDP:

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
    },
});
```

  Приглашение для теста — через `POST /api/admin/invites` под сессией админа или CLI бэкенда.

## 10. Чек-лист BE-22

- [ ] `apiClient`: выход только при `401 unauthorized` (§3), тест на `401 auth_failed` без выхода.
- [ ] Хелперы сериализации WebAuthn (§4) или согласованная библиотека; тест на `clientExtensionResults` и base64url.
- [ ] Экран входа с одной кнопкой (§5.1), обработка ошибок §6.
- [ ] Маршрут `/invite`: чтение и удаление фрагмента, `inspect`, формы `join`/`recovery`, регистрация (§5.2).
- [ ] «Мои ключи»: список, добавление с `reauth_required`, переименование, удаление с `last_passkey` (§5.3).
- [ ] Админка: приглашения (ссылка показывается один раз), пользователи, отключение, восстановление (§5.4).
- [ ] Удалён OAuth: `authError.js`, `providers.js`, `ProviderIcon.js`, `/mock-provider`, тексты `auth_error` (§2).
- [ ] mock-BFF и e2e переведены на passkey или на реальный бэкенд с виртуальным аутентификатором (§9).
- [ ] Память клиента: `auth-contract.md` ссылается на `docs/client-integration.md` §2 бэкенда.
