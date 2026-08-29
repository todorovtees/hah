# HAH

Самостоятелен разговорен AI интерфейс на Todorov Tees, достъпен на
`https://hah.todorovtees.com`. React + TypeScript + Vite фронтенд, хостван
статично в GitHub Pages; Supabase за автентикация, база данни, файлово
хранилище и server-side логика (Edge Functions); Gemini API като модел
доставчик зад Edge Functions слой — никога директно от браузъра.

Тази документация е за разработчици/администратори. Пълната архитектура,
зависимости и доставчици са описани тук нарочно — крие се само от
*видимия потребителски интерфейс* (виж [§ Продуктово поведение](#продуктово-поведение)),
не от документацията.

## Съдържание

- [Архитектура](#архитектура)
- [Преди да започнете](#преди-да-започнете)
- [1. Supabase проект](#1-supabase-проект)
- [2. Първи администратор (bootstrap)](#2-първи-администратор-bootstrap)
- [3. Edge Functions](#3-edge-functions)
- [4. GitHub repository и Actions](#4-github-repository-и-actions)
- [5. GitHub Pages + custom domain](#5-github-pages--custom-domain)
- [6. Локална разработка](#6-локална-разработка)
- [Data privacy](#data-privacy)
- [Продуктово поведение](#продуктово-поведение)
- [Известни ограничения / бъдещи подобрения](#известни-ограничения--бъдещи-подобрения)

## Архитектура

```
User → hah.todorovtees.com (GitHub Pages, static React build)
         │
         ▼
     Supabase
       ├── Auth (allowlist-only, no public signup)
       ├── PostgreSQL (+ Row Level Security на всяка таблица)
       ├── Storage (private bucket "hah-files")
       └── Edge Functions (Deno)
             ├── chat            → Gemini streamGenerateContent (+ Google Search grounding)
             ├── search          → самостоятелно уеб търсене
             ├── process-file    → валидация (magic bytes) + текст извличане
             └── admin-users     → всички административни операции
```

Frontend-ът никога не съдържа `SUPABASE_SERVICE_ROLE_KEY` или
`GEMINI_API_KEY`. Единствените публични стойности са
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, което е безопасно **само**
защото RLS е включен навсякъде — anon key сам по себе си не дава достъп до
нищо.

## Преди да започнете

Необходими са ви:

- GitHub акаунт + празен repository, наречен `hah`
- Supabase акаунт (безплатен план е достатъчен за старт)
- Gemini API key (от Google AI Studio)
- Достъп до DNS записите на `todorovtees.com`

Всичко по-долу може да се направи **изцяло през браузъра** — качване на
GitHub (drag & drop upload), миграции и Edge Functions (Supabase Dashboard),
build (GitHub Actions). Node.js/npm и `supabase` CLI трябват само ако
предпочитате терминал вместо браузър, или искате локална разработка
(вижте [§6](#6-локална-разработка)).

## 1. Supabase проект

1. Създайте нов проект в [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email**: изключете "Allow new users to
   sign up" (`enable_signup = false`, вече зададено и в `supabase/config.toml`
   за локална разработка). Само admin-покани създават акаунти.
3. Приложете миграциите, за да се създадат всички таблици, RLS политики,
   storage bucket-а и helper функциите. Два начина:

   **Без CLI (през браузъра):** Dashboard → **SQL Editor** → **New query**.
   Отворете всеки файл в `supabase/migrations/` **по ред** (0001, 0002, …
   0008), копирайте съдържанието му, поставете го в SQL Editor и натиснете
   **Run**. Повторете за всеки файл — важно е редът, защото по-късен файл
   разчита на таблици/функции от по-ранен.

   **С CLI:**

   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push
   ```

4. **Project Settings → API**: копирайте `Project URL` и `anon public` key
   → ще отидат във `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
   Копирайте и `service_role` key (пазете го строго — само за Edge Function
   secrets, никога във frontend).

## 2. Първи администратор (bootstrap)

Поканите обикновено минават през admin панела в приложението — но за
*първия* администратор няма кой да натисне бутона, затова:

1. В Supabase Dashboard → SQL Editor изпълнете (с реалния имейл):

   ```sql
   insert into public.authorized_users (email, display_name, role, is_active)
   values ('you@todorovtees.com', 'Вашето име', 'admin', true);
   ```

2. Authentication → Users → **Invite user** → въведете същия имейл.
3. `handle_new_user()` тригерът автоматично ще създаде `profiles` ред с
   `role = 'admin'`, защото имейлът вече е активен в `authorized_users`.
4. Приемете поканата от пощата си, задайте парола, влезте в
   `hah.todorovtees.com` (след като е деплойнат) или `localhost:5173`.
5. Оттук нататък — поканвайте останалите потребители от `/admin` в
   приложението.

## 3. Edge Functions

Всяка от четирите функции (`chat`, `search`, `process-file`, `admin-users`)
е написана нарочно **самостоятелна** — целият ѝ код е в един файл
`index.ts`, без връзки към други файлове. Това е, за да може да се качи и
директно през браузъра, без CLI.

**Без CLI (през браузъра):** Dashboard → **Edge Functions** → **Deploy a new
function** → изберете **Via editor** (не "Via CLI") → именувайте функцията
точно `chat` → изтрийте примерния код в редактора → отворете
`supabase/functions/chat/index.ts` от проекта, копирайте **цялото**
съдържание, поставете го в редактора → **Deploy**. Повторете същото за
`search`, `process-file` и `admin-users` (име на функцията = име на папката
= името в първия ред на всеки файл).

**С CLI:**

```bash
supabase functions deploy chat
supabase functions deploy search
supabase functions deploy process-file
supabase functions deploy admin-users
```

И по двата начина накрая задайте server-side secrets — Dashboard → **Edge
Functions → Manage secrets** (или през CLI, ако предпочитате):

```
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash
```

(`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` обикновено вече присъстват
автоматично в средата на Edge Functions — не е нужно да ги задавате ръчно,
освен ако Dashboard-ът изрично не поиска.)

## 4. GitHub repository и Actions

1. Push-нете това repository в `github.com/<org>/hah`.
2. Repo → **Settings → Secrets and variables → Actions** → добавете:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Repo → **Settings → Pages → Build and deployment → Source** →
   `GitHub Actions`.
4. Push към `main` ще пусне `.github/workflows/deploy.yml`, което прекъсва
   при TypeScript грешки, lint грешки или build грешки, и деплойва само при
   успех.

## 5. GitHub Pages + custom domain

1. Repo → Settings → Pages → **Custom domain** → `hah.todorovtees.com` →
   Save. (Полето вече е зададено и във файла `public/CNAME`, който отива в
   `dist/` при всеки build.)
2. При вашия DNS доставчик за `todorovtees.com`, добавете:

   ```
   Type:  CNAME
   Name:  hah
   Value: <org>.github.io.
   ```

   (Точната `Value` GitHub Pages я показва в Settings → Pages, след като
   изпратите заявка за custom domain.)
3. Изчакайте DNS propagation, после в Settings → Pages включете **Enforce
   HTTPS**. Никога не оставяйте сайта достъпен по чист HTTP.

## 6. Локална разработка

```bash
cp .env.example .env.local   # попълнете VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

За локален Supabase emulator (по избор): `supabase start`, после сочете
`.env.local` към `http://localhost:54321` и локалния anon key, който
командата отпечатва.

Преди push, за да минете CI-то:

```bash
npm run typecheck
npm run lint
npm run build
```

## Data privacy

1. **Какви данни се изпращат към външни услуги.** Текстът на съобщенията,
   историята на разговора (последните ~60 съобщения) и съдържанието на
   прикачени файлове (или извлечен от тях текст) се изпращат към Google
   Gemini API за генериране на отговор. Когато е активирано уеб търсене,
   заявката за търсене също минава през Gemini (Google Search grounding).
2. **Какви файлове могат да бъдат качвани.** PDF, TXT, CSV, DOCX, XLSX,
   PPTX, JPG/PNG/WEBP, MP3/WAV, MP4/MOV — до 25MB. Вижте
   `supabase/functions/process-file` за пълната валидационна логика
   (magic-byte проверка, не само декларирания MIME type).
3. **Къде се съхраняват разговорите.** В Supabase PostgreSQL (таблици
   `conversations`, `messages`), в региона на вашия Supabase проект.
   Файловете — в частен Supabase Storage bucket `hah-files`, никога
   публичен, достъпен само чрез краткотрайни signed URLs или на притежателя
   си през RLS.
4. **Кой има достъп.** Всеки потребител вижда само собствените си
   разговори/файлове (RLS). Администратори могат да четат всички редове
   (за поддръжка/модерация) — вижте `0006_rls_policies.sql`. Единствено
   `service_role` (Edge Functions) записва в `usage_logs`/`system_logs` и
   изпълнява административни операции.
5. **Как се изтриват данните.** Изтриване на разговор (`DELETE`) каскадно
   трие съобщенията и прикачените файлове (DB редове + storage обекти чрез
   `on delete cascade` за DB; storage обектите се трият изрично от
   `lib/files.ts` при премахване на прикачен файл, и трябва да се изтрият
   ръчно/по periodic job за bucket cleanup при изтрит разговор — виж
   [Известни ограничения](#известни-ограничения--бъдещи-подобрения)).
6. **Как се обработват логовете.** `usage_logs` пази метаданни за заявки
   (тип, модел, размери, продължителност, статус) — **не** пази съдържание
   на съобщения. `system_logs` пази технически грешки за администратори;
   не трябва да съдържа secrets или пълни request body-та (вижте коментара
   в `0004_usage_system_logs.sql`).

Няма скрити зависимости — единствените external endpoints, към които
Edge Functions правят заявки, са `generativelanguage.googleapis.com`
(Gemini) и самия Supabase проект.

## Продуктово поведение

Видимият интерфейс показва само "HAH" — лого, заглавие, съобщения за
грешки. Системната инструкция към модела (`supabase/functions/chat/index.ts`,
`SYSTEM_INSTRUCTION`) изрично казва на модела да не споменава доброволно
доставчика, но **да отговори честно**, ако потребител директно и сериозно
попита кой стои зад HAH — това не е заобикаляне на прозрачност, а просто
UI, който не рекламира чужд бранд без нужда. Тази документация изброява
всички реални зависимости за администратори/разработчици.

## Известни ограничения / бъдещи подобрения

Тези неща работят реално, но са опростени спрямо пълния 40-точков spec —
маркирани тук изрично, вместо мълчаливо подминати:

- **Storage cleanup при изтрит разговор**: DB редовете за `attachments` се
  трият каскадно с разговора, но самите файлове в Storage не се трият
  автоматично от тригер (Storage не поддържа DB triggers директно) — добавете
  периодична Edge Function (cron чрез `pg_cron` или Supabase Scheduled
  Functions), която трие storage обекти без съответен `attachments` ред.
- **Аудио запис от микрофон в браузъра** не е имплементиран (само upload на
  вече записан аудио файл) — spec-ът го маркира като по избор, зависещо от
  browser permissions.
- **Виртуализация на дълъг списък с разговори** (spec §31) не е добавена —
  при хиляди разговори добавете `react-virtual` или подобно в `Sidebar`.
- **Роли `manager`/`employee`/`viewer`** (spec §8, "по-късно") не са
  добавени — схемата (`role text check (role in ('admin','user'))`) е
  умишлено проста за начало; разширете constraint-а и RLS политиките при
  нужда.
- **Rate limiting** е sliding-window по потребител на ниво Postgres
  (`count_recent_usage`), не по IP — добавете IP-базирано ограничение на
  ниво Edge Function, ако е нужно (напр. чрез `x-forwarded-for` header).
