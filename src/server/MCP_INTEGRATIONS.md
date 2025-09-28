Available MCP integrations that are helpful for this project and how they can assist:

- Neon: serverless Postgres database. Use to store users, balances, energy state and analytics. Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Neon.
- Netlify: deployment and hosting for static MiniApp (if you prefer). Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Netlify.
- Zapier: automation (e.g., notify admins on large balance changes). Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Zapier.
- Figma: convert designs to code using Builder.io Figma plugin. Use the "Get Plugin" button in MCP Servers or visit Figma plugin: https://www.figma.com/community/plugin/747985167520967365/builder-io-ai-powered-figma-to-code-react-vue-tailwind-more
- Supabase: alternative to Neon for database and auth (not required if Neon is used). Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Supabase.
- Builder.io (Builder CMS): manage game content, assets and pages. Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Builder.io.
- Linear: issue tracking and project management integration. Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Linear.
- Notion: documentation and knowledge base. Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Notion.
- Sentry: error monitoring for bot and MiniApp. Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Sentry.
- Context7: up-to-date docs for libraries used in the project. Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Context7.
- Semgrep: security scanning for the codebase. Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Semgrep.
- Prisma Postgres: use Prisma ORM for advanced DB modeling (optional). Connect via [Open MCP popover](#open-mcp-popover) -> Connect to Prisma.

How they relate to current task:
- Neon: REQUIRED to store user state (we created DB client that reads NEON_DATABASE_URL).
- Netlify/Builder.io: useful if you want to host the MiniApp separately and manage pages visually.
- AdsGram: Ads integration (AdsGram) should be connected when ready; we will add reward callback URL at /reward which AdsGram can call.

To connect any MCP server: click [Open MCP popover](#open-mcp-popover) and choose the service (Neon, Netlify, Zapier, Figma, Supabase, Builder.io, Linear, Notion, Sentry, Context7, Semgrep, Prisma, etc.).

Note: The project expects the following environment variables to be set in Railway or your deployment platform:
- TG_BOT_TOKEN
- NEON_DATABASE_URL
- ADMIN_ID
- BOT_USERNAME
- BASE_URL
- NODE_ENV

We already read NEON_DATABASE_URL and TG_BOT_TOKEN from environment in src/server/bot.js and src/server/db.js.
