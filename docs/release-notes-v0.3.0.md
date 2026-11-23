## Dual VTT v0.3.0 — art, a real table, and a home for players and GMs

Since SRD 2.0 we've rebuilt most of what you see and a good part of how a session runs. Project page: https://cristosolar.github.io/dual-vtt/

### All-new art
- Painted illustrations for all 13 classes, 24 ancestries, 15 communities, and every tier-1 weapon and armor (61 pieces).
- Original icons and colours for the 10 domains.
- Art is about a tenth of its old file size, and versioned URLs mean nobody sees stale pictures after an update.

### Character creation
- Class, ancestry, community and equipment are picked from a 3D card carousel: full art, key stats, the class's domains with their icons, and "Ver detalle" for the full text.
- Equipment only lists what your character can legally take (tier 1, magic weapons only with a Spellcast trait, no off-hand with a two-handed weapon) and puts first the weapons that use your best traits.
- Domain cards are grouped by domain, coloured, sorted by level, with long text collapsed.
- Everything that showed raw English ids in the Spanish UI ("Spell", "Midnight", "blade") is translated.

### For players: Mis personajes / Mis campañas
- Characters now live on the server, tied to your account: create as many as you want from any device and link each one to a campaign.
- Campaigns arrive as invitations you accept or decline.
- Characters left in a browser by the old flow can be imported in one click.

### For GMs: Mis campañas / Mis jugadores
- Campaigns are Active, Paused or Finished. Pausing cuts players off until you resume.
- Each campaign has a page with its Story (GM only), Notes (the journal, shareable per entry), a Monster prep list you can drop into the encounter in one click, and its Players and invitations.
- Mis jugadores lists your players with their campaigns, last sign-in, password reset and invites.

### At the table (Foundry-style features)
- **Chat** with whispers, plus **private rolls** that only you and the GM see.
- **Dice tray**: duality with advantage/disadvantage, or any mix of d4–d100 with a modifier. All dice are rolled on the server.
- **3D dice** that linger, then fade.
- **History panel** on the map with rolls, messages, and spells and features as they're used.
- **Targets**: a roll against a target uses its Difficulty, and the GM can apply damage to adversaries by threshold.
- **Hotbar** with keys 1–0, **map pings** (Alt+click), a **journal** with map pins, **synced music** for the whole table, GM **random tables**, and map **regions** that warn the GM when a token enters a hazard.

### Fixes worth knowing
- Consecutive rolls kept landing on the same faces because of the dice seeding. That's fixed.
- Finishing a character during a brief disconnect no longer fails with "join a campaign first", and the wizard no longer gets stuck on step 9.
- After a server restart you're sent back to the login screen instead of staying "offline" forever.
- Replaced art now reaches browsers instead of staying cached for a year.
- GMs can only manage their own players (before, any GM could reset any account).

### Upgrading
Back up `apps/server/.data/` first. On first boot the server moves the characters already seated in campaigns into their owners' libraries. Everyone has to sign in again after a restart, as before.
