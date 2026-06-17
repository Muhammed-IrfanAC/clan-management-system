# ClanOps: Clash of Clans Management System

ClanOps is a specialized command dashboard designed for Clash of Clans clan leadership. It centralizes member tracking, enforcement, and activity logging across multiple clans in a family.

## 🚀 Features

- **Tag-Based Auth**: No passwords or emails. Identity is verified via your Clash of Clans player tag.
- **Roster Sync**: Automatically syncs clan rosters (levels, roles, trophies, donations) from the official CoC API.
- **Member Registry**: Link multiple alt accounts to a single "Human" identity.
- **Warning System**: Log rule violations with specialized guidance (e.g., Capital Sandbagging). Unacknowledged warnings automatically escalate to **HIGH**.
- **Activity Log**: Keep a permanent record of promotions, demotions, war decisions, and recruitment.
- **Command Center**: Full control over clan registry, rule library, and system behavior (sync intervals, cleanup days).
- **OLED Dark Mode**: Immersive gaming-themed UI designed for high performance and visual impact.

## 🛠 Tech Stack

- **Frontend/Backend**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: JWT-based with CoC API verification
- **Icons**: Lucide React
- **Styles**: Vanilla CSS + Global Design System

## ⚙️ Setup

### 1. Database Initialization
Run the contents of `supabase_setup.sql` in your Supabase SQL Editor. This will create all necessary tables and seed initial settings.

### 2. Environment Variables
Create a `.env.local` file with the following:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Auth
JWT_SECRET=your_secure_random_string

# CoC API
COC_API_TOKEN=your_coc_api_token
COC_API_PROXY_URL=https://cocproxy.royaleapi.dev/v1 # Optional but recommended
```

### 3. Register your Clan
Manually insert your clan tag into the `clans` table:
```sql
INSERT INTO clans (clan_tag, display_name, clan_type) 
VALUES ('#YOUR_CLAN_TAG', 'Main Clan', 'main');
```

## 🚀 Deployment (Vercel)

1. Push this repo to your GitHub.
2. Connect the repo to a new Vercel Project.
3. Add the environment variables from `.env.local` to the Vercel project settings.
4. Deploy!

## ⚔️ Command your Clan

Log in with your player tag. If you are a Leader or Co-Leader in a registered clan, you will be automatically onboarded. To grant yourself **Super Admin** privileges, update your role in the `player_accounts` table:

```sql
UPDATE player_accounts SET db_role = 'super_admin' WHERE player_tag = '#YOUR_TAG';
```

---
Built with 🛡 for Clash of Clans Leadership.
