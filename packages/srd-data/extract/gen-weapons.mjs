import fs from 'node:fs';

// rows: name | tier | category | trait | range | damage | burden | feature ('-' = none)
const ROWS = `
Broadsword|1|primary|Agility|Melee|d8 phy|1|Reliable: +1 to attack rolls
Longsword|1|primary|Agility|Melee|d10+3 phy|2|-
Battleaxe|1|primary|Strength|Melee|d10+3 phy|2|-
Greatsword|1|primary|Strength|Melee|d10+3 phy|2|Massive: −1 to Evasion; on a successful attack, roll an additional damage die and discard the lowest result.
Mace|1|primary|Strength|Melee|d8+1 phy|1|-
Warhammer|1|primary|Strength|Melee|d12+3 phy|2|Heavy: −1 to Evasion
Dagger|1|primary|Finesse|Melee|d8+1 phy|1|-
Quarterstaff|1|primary|Instinct|Melee|d10+3 phy|2|-
Cutlass|1|primary|Presence|Melee|d8+1 phy|1|-
Rapier|1|primary|Presence|Melee|d8 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Halberd|1|primary|Strength|Very Close|d10+2 phy|2|Cumbersome: −1 to Finesse
Spear|1|primary|Finesse|Very Close|d8+3 phy|2|-
Shortbow|1|primary|Agility|Far|d6+3 phy|2|-
Crossbow|1|primary|Finesse|Far|d6+1 phy|1|-
Longbow|1|primary|Agility|Very Far|d8+3 phy|2|Cumbersome: −1 to Finesse
Arcane Gauntlets|1|primary|Strength|Melee|d10+3 mag|2|-
Hallowed Axe|1|primary|Strength|Melee|d8+1 mag|1|-
Glowing Rings|1|primary|Agility|Very Close|d10+2 mag|2|-
Hand Runes|1|primary|Instinct|Very Close|d10 mag|1|-
Returning Blade|1|primary|Finesse|Close|d8 mag|1|Returning: When this weapon is thrown within its range, it appears in your hand immediately after the attack.
Shortstaff|1|primary|Instinct|Close|d8+1 mag|1|-
Dualstaff|1|primary|Instinct|Far|d6+3 mag|2|-
Scepter|1|primary|Presence|Far|d6 mag|2|Versatile: This weapon can also be used with these statistics—Presence, Melee, d8.
Wand|1|primary|Knowledge|Far|d6+1 mag|1|-
Greatstaff|1|primary|Knowledge|Very Far|d6 mag|2|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.

Improved Broadsword|2|primary|Agility|Melee|d8+3 phy|1|Reliable: +1 to attack rolls
Improved Longsword|2|primary|Agility|Melee|d10+6 phy|2|-
Improved Battleaxe|2|primary|Strength|Melee|d10+6 phy|2|-
Improved Greatsword|2|primary|Strength|Melee|d10+6 phy|2|Massive: −1 to Evasion; on a successful attack, roll an additional damage die and discard the lowest result.
Improved Mace|2|primary|Strength|Melee|d8+4 phy|1|-
Improved Warhammer|2|primary|Strength|Melee|d12+6 phy|2|Heavy: −1 to Evasion
Improved Dagger|2|primary|Finesse|Melee|d8+4 phy|1|-
Improved Quarterstaff|2|primary|Instinct|Melee|d10+6 phy|2|-
Improved Cutlass|2|primary|Presence|Melee|d8+4 phy|1|-
Improved Rapier|2|primary|Presence|Melee|d8+3 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Improved Halberd|2|primary|Strength|Very Close|d10+5 phy|2|Cumbersome: −1 to Finesse
Improved Spear|2|primary|Finesse|Very Close|d8+6 phy|2|-
Improved Shortbow|2|primary|Agility|Far|d6+6 phy|2|-
Improved Crossbow|2|primary|Finesse|Far|d6+4 phy|1|-
Improved Longbow|2|primary|Agility|Very Far|d8+6 phy|2|Cumbersome: −1 to Finesse
Gilded Falchion|2|primary|Strength|Melee|d10+4 phy|1|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Knuckle Blades|2|primary|Strength|Melee|d10+6 phy|2|Brutal: When you roll the maximum value on a damage die, roll an additional damage die.
Urok Broadsword|2|primary|Finesse|Melee|d8+3 phy|1|Deadly: When you deal Severe damage, the target must mark an additional HP.
Bladed Whip|2|primary|Agility|Very Close|d8+3 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Steelforged Halberd|2|primary|Strength|Very Close|d8+4 phy|2|Scary: On a successful attack, the target must mark a Stress.
War Scythe|2|primary|Finesse|Very Close|d8+5 phy|2|Reliable: +1 to attack rolls
Blunderbuss|2|primary|Finesse|Close|d8+6 phy|2|Reloading: After you make an attack, roll a d6. On a result of 1, you must mark a Stress to reload this weapon before you can fire it again.
Greatbow|2|primary|Strength|Far|d6+6 phy|2|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Finehair Bow|2|primary|Agility|Very Far|d6+5 phy|2|Reliable: +1 to attack rolls
Improved Arcane Gauntlets|2|primary|Strength|Melee|d10+6 mag|2|-
Improved Hallowed Axe|2|primary|Strength|Melee|d8+4 mag|1|-
Improved Glowing Rings|2|primary|Agility|Very Close|d10+5 mag|2|-
Improved Hand Runes|2|primary|Instinct|Very Close|d10+3 mag|1|-
Improved Returning Blade|2|primary|Finesse|Close|d8+3 mag|1|Returning: When this weapon is thrown within its range, it appears in your hand immediately after the attack.
Improved Shortstaff|2|primary|Instinct|Close|d8+4 mag|1|-
Improved Dualstaff|2|primary|Instinct|Far|d6+6 mag|2|-
Improved Scepter|2|primary|Presence|Far|d6+3 mag|2|Versatile: This weapon can also be used with these statistics—Presence, Melee, d8+3.
Improved Wand|2|primary|Knowledge|Far|d6+4 mag|1|-
Improved Greatstaff|2|primary|Knowledge|Very Far|d6+3 mag|2|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Ego Blade|2|primary|Agility|Melee|d12+4 mag|1|Pompous: You must have a Presence of 0 or lower to use this weapon.
Casting Sword|2|primary|Strength|Melee|d10+4 mag|2|Versatile: This weapon can also be used with these statistics—Knowledge, Far, d6+3.
Devouring Dagger|2|primary|Finesse|Melee|d8+4 mag|1|Scary: On a successful attack, the target must mark a Stress.
Hammer of Exota|2|primary|Instinct|Melee|d8+6 mag|2|Eruptive: On a successful attack against a target within Melee range, all other adversaries within Very Close range must succeed on a reaction roll (14) or take half damage.
Yutari Bloodbow|2|primary|Finesse|Far|d6+4 mag|2|Brutal: When you roll the maximum value on a damage die, roll an additional damage die.
Elder Bow|2|primary|Instinct|Far|d6+4 mag|2|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Scepter of Elias|2|primary|Presence|Far|d6+3 mag|1|Invigorating: On a successful attack, roll a d4. On a result of 4, clear a Stress.
Wand of Enthrallment|2|primary|Presence|Far|d6+4 mag|1|Persuasive: Before you make a Presence Roll, you can mark a Stress to gain a +2 bonus to the result.
Keeper's Staff|2|primary|Knowledge|Far|d6+4 mag|2|Reliable: +1 to attack rolls

Advanced Broadsword|3|primary|Agility|Melee|d8+6 phy|1|Reliable: +1 to attack rolls
Advanced Longsword|3|primary|Agility|Melee|d10+9 phy|2|-
Advanced Battleaxe|3|primary|Strength|Melee|d10+9 phy|2|-
Advanced Greatsword|3|primary|Strength|Melee|d10+9 phy|2|Massive: −1 to Evasion; on a successful attack, roll an additional damage die and discard the lowest result.
Advanced Mace|3|primary|Strength|Melee|d8+7 phy|1|-
Advanced Warhammer|3|primary|Strength|Melee|d12+9 phy|2|Heavy: −1 to Evasion
Advanced Dagger|3|primary|Finesse|Melee|d8+7 phy|1|-
Advanced Quarterstaff|3|primary|Instinct|Melee|d10+9 phy|2|-
Advanced Cutlass|3|primary|Presence|Melee|d8+7 phy|1|-
Advanced Rapier|3|primary|Presence|Melee|d8+6 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Advanced Halberd|3|primary|Strength|Very Close|d10+8 phy|2|Cumbersome: −1 to Finesse
Advanced Spear|3|primary|Finesse|Very Close|d8+9 phy|2|-
Advanced Shortbow|3|primary|Agility|Far|d6+9 phy|2|-
Advanced Crossbow|3|primary|Finesse|Far|d6+7 phy|1|-
Advanced Longbow|3|primary|Agility|Very Far|d8+9 phy|2|Cumbersome: −1 to Finesse
Flickerfly Blade|3|primary|Agility|Melee|d8+5 phy|1|Sharpwing: Gain a bonus to your damage rolls equal to your Agility.
Bravesword|3|primary|Strength|Melee|d12+7 phy|2|Brave: −1 to Evasion; +3 to Severe damage threshold
Hammer of Wrath|3|primary|Strength|Melee|d10+7 phy|2|Devastating: Before you make an attack roll, you can mark a Stress to use a d20 as your damage die.
Labrys Axe|3|primary|Strength|Melee|d10+7 phy|2|Protective: +1 to Armor Score
Meridian Cutlass|3|primary|Presence|Melee|d10+5 phy|1|Dueling: When there are no other creatures within Close range of the target, gain advantage on your attack roll against them.
Retractable Saber|3|primary|Presence|Melee|d10+7 phy|1|Retractable: The blade can be hidden in the hilt to avoid detection.
Double Flail|3|primary|Agility|Very Close|d10+8 phy|2|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Talon Blades|3|primary|Finesse|Close|d10+7 phy|2|Brutal: When you roll the maximum value on a damage die, roll an additional damage die.
Black Powder Revolver|3|primary|Finesse|Far|d6+8 phy|1|Reloading: After you make an attack, roll a d6. On a result of 1, you must mark a Stress to reload this weapon before you can fire it again.
Spiked Bow|3|primary|Agility|Very Far|d6+7 phy|2|Versatile: This weapon can also be used with these statistics—Agility, Melee, d10+5.
Advanced Arcane Gauntlets|3|primary|Strength|Melee|d10+9 mag|2|-
Advanced Hallowed Axe|3|primary|Strength|Melee|d8+7 mag|1|-
Advanced Glowing Rings|3|primary|Agility|Very Close|d10+8 mag|2|-
Advanced Hand Runes|3|primary|Instinct|Very Close|d10+6 mag|1|-
Advanced Returning Blade|3|primary|Finesse|Close|d8+6 mag|1|Returning: When this weapon is thrown within its range, it appears in your hand immediately after the attack.
Advanced Shortstaff|3|primary|Instinct|Close|d8+7 mag|1|-
Advanced Dualstaff|3|primary|Instinct|Far|d6+9 mag|2|-
Advanced Scepter|3|primary|Presence|Far|d6+6 mag|2|Versatile: This weapon can also be used with these statistics—Presence, Melee, d8+4.
Advanced Wand|3|primary|Knowledge|Far|d6+7 mag|1|-
Advanced Greatstaff|3|primary|Knowledge|Very Far|d6+6 mag|2|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Axe of Fortunis|3|primary|Strength|Melee|d10+8 mag|2|Lucky: On a failed attack, you can mark a Stress to reroll your attack.
Blessed Anlace|3|primary|Instinct|Melee|d10+6 mag|1|Healing: During downtime, automatically clear a Hit Point.
Ghostblade|3|primary|Presence|Melee|d10+7 both|1|Otherworldly: On a successful attack, you can deal physical or magic damage.
Runes of Ruination|3|primary|Knowledge|Very Close|d20+4 mag|1|Painful: Each time you make a successful attack, you must mark a Stress.
Widogast Pendant|3|primary|Knowledge|Close|d10+5 mag|1|Timebending: You choose the target of your attack after making your attack roll.
Gilded Bow|3|primary|Finesse|Far|d6+7 mag|2|Self-Correcting: When you roll a 1 on a damage die, it deals 6 damage instead.
Firestaff|3|primary|Instinct|Far|d6+7 mag|2|Burning: When you roll a 6 on a damage die, the target must mark a Stress.
Mage Orb|3|primary|Knowledge|Far|d6+7 mag|1|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Ilmari's Rifle|3|primary|Finesse|Very Far|d6+6 mag|1|Reloading: After you make an attack, roll a d6. On a result of 1, you must mark a Stress to reload this weapon before you can fire it again.

Legendary Broadsword|4|primary|Agility|Melee|d8+9 phy|1|Reliable: +1 to attack rolls
Legendary Longsword|4|primary|Agility|Melee|d10+12 phy|2|-
Legendary Battleaxe|4|primary|Strength|Melee|d10+12 phy|2|-
Legendary Greatsword|4|primary|Strength|Melee|d10+12 phy|2|Massive: −1 to Evasion; on a successful attack, roll an additional damage die and discard the lowest result.
Legendary Mace|4|primary|Strength|Melee|d8+10 phy|1|-
Legendary Warhammer|4|primary|Strength|Melee|d12+12 phy|2|Heavy: −1 to Evasion
Legendary Dagger|4|primary|Finesse|Melee|d8+10 phy|1|-
Legendary Quarterstaff|4|primary|Instinct|Melee|d10+12 phy|2|-
Legendary Cutlass|4|primary|Presence|Melee|d8+10 phy|1|-
Legendary Rapier|4|primary|Presence|Melee|d8+9 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Legendary Halberd|4|primary|Strength|Very Close|d10+11 phy|2|Cumbersome: −1 to Finesse
Legendary Spear|4|primary|Finesse|Very Close|d8+12 phy|2|-
Legendary Shortbow|4|primary|Agility|Far|d6+12 phy|2|-
Legendary Crossbow|4|primary|Finesse|Far|d6+10 phy|1|-
Legendary Longbow|4|primary|Agility|Very Far|d8+12 phy|2|Cumbersome: −1 to Finesse
Dual-Ended Sword|4|primary|Agility|Melee|d10+9 phy|2|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Impact Gauntlet|4|primary|Strength|Melee|d10+11 phy|1|Concussive: On a successful attack, you can spend a Hope to knock the target back to Far range.
Sledge Axe|4|primary|Strength|Melee|d12+13 phy|2|Destructive: −1 to Agility; on a successful attack, all adversaries within Very Close range must mark a Stress.
Curved Dagger|4|primary|Finesse|Melee|d8+9 phy|1|Serrated: When you roll a 1 on a damage die, it deals 8 damage instead.
Extended Polearm|4|primary|Finesse|Very Close|d8+10 phy|2|Long: This weapon's attack targets all adversaries in a line within range.
Swinging Ropeblade|4|primary|Presence|Close|d8+9 phy|2|Grappling: On a successful attack, you can spend a Hope to Restrain the target or pull them into Melee range with you.
Ricochet Axes|4|primary|Agility|Far|d6+11 phy|2|Bouncing: Mark 1 or more Stress to hit that many targets in range of the attack.
Aantari Bow|4|primary|Finesse|Far|d6+11 phy|2|Reliable: +1 to attack rolls
Hand Cannon|4|primary|Finesse|Very Far|d6+12 phy|1|Reloading: After you make an attack, roll a d6. On a 1, you must mark a Stress to reload this weapon before you can fire it again.
Legendary Arcane Gauntlets|4|primary|Strength|Melee|d10+12 mag|2|-
Legendary Hallowed Axe|4|primary|Strength|Melee|d8+10 mag|1|-
Legendary Glowing Rings|4|primary|Agility|Very Close|d10+11 mag|2|-
Legendary Hand Runes|4|primary|Instinct|Very Close|d10+9 mag|1|-
Legendary Returning Blade|4|primary|Finesse|Close|d8+9 mag|1|Returning: When this weapon is thrown within its range, it appears in your hand immediately after the attack.
Legendary Shortstaff|4|primary|Instinct|Close|d8+10 mag|1|-
Legendary Dualstaff|4|primary|Instinct|Far|d8+12 mag|2|-
Legendary Scepter|4|primary|Presence|Far|d6+9 mag|2|Versatile: This weapon can also be used with these statistics—Presence, Melee, d8+6.
Legendary Wand|4|primary|Knowledge|Far|d6+10 mag|1|-
Legendary Greatstaff|4|primary|Knowledge|Very Far|d6+9 mag|2|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Sword of Light & Flame|4|primary|Strength|Melee|d10+11 mag|2|Hot: This weapon cuts through solid material.
Siphoning Gauntlets|4|primary|Presence|Melee|d10+9 mag|2|Lifestealing: On a successful attack, roll a d6. On a result of 6, clear a Hit Point or clear a Stress.
Midas Scythe|4|primary|Knowledge|Melee|d10+9 mag|2|Greedy: Spend a handful of gold to gain a +1 bonus to your Proficiency on a damage roll.
Floating Bladeshards|4|primary|Instinct|Close|d8+9 mag|1|Powerful: On a successful attack, roll an additional damage die and discard the lowest result.
Bloodstaff|4|primary|Instinct|Far|d20+7 mag|2|Painful: Each time you make a successful attack, you must mark a Stress.
Thistlebow|4|primary|Instinct|Far|d6+13 mag|2|Reliable: +1 to attack rolls
Wand of Essek|4|primary|Knowledge|Far|d8+13 mag|1|Timebending: You can choose the target of your attack after making your attack roll.
Magus Revolver|4|primary|Finesse|Very Far|d6+13 mag|1|Reloading: After you make an attack, roll a d6. On a result of 1, you must mark a Stress to reload this weapon before you can fire it again.
Fusion Gloves|4|primary|Knowledge|Very Far|d6+9 mag|2|Bonded: Gain a bonus to your damage rolls equal to your level.

Shortsword|1|secondary|Agility|Melee|d8 phy|1|Paired: +2 to primary weapon damage to targets within Melee range
Round Shield|1|secondary|Strength|Melee|d4 phy|1|Protective: +1 to Armor Score
Tower Shield|1|secondary|Strength|Melee|d6 phy|1|Barrier: +2 to Armor Score; −1 to Evasion
Small Dagger|1|secondary|Finesse|Melee|d8 phy|1|Paired: +2 to primary weapon damage to targets within Melee range
Whip|1|secondary|Presence|Very Close|d6 phy|1|Startling: Mark a Stress to crack the whip and force all adversaries within Melee range back to Close range.
Grappler|1|secondary|Finesse|Close|d6 phy|1|Hooked: On a successful attack, you can pull the target into Melee range.
Hand Crossbow|1|secondary|Finesse|Far|d6+1 phy|1|-

Improved Shortsword|2|secondary|Agility|Melee|d8+2 phy|1|Paired: +3 to primary weapon damage to targets within Melee range
Improved Round Shield|2|secondary|Strength|Melee|d4+2 phy|1|Protective: +2 to Armor Score
Improved Tower Shield|2|secondary|Strength|Melee|d6+2 phy|1|Barrier: +3 to Armor Score; −1 to Evasion
Improved Small Dagger|2|secondary|Finesse|Melee|d8+2 phy|1|Paired: +3 to primary weapon damage to targets within Melee range
Improved Whip|2|secondary|Presence|Very Close|d6+2 phy|1|Startling: Mark a Stress to crack the whip and force all adversaries within Melee range back to Close range.
Improved Grappler|2|secondary|Finesse|Close|d6+2 phy|1|Hooked: On a successful attack, you can pull the target into Melee range.
Improved Hand Crossbow|2|secondary|Finesse|Far|d6+3 phy|1|-
Spiked Shield|2|secondary|Strength|Melee|d6+2 phy|1|Double Duty: +1 to Armor Score; +1 to primary weapon damage within Melee range
Parrying Dagger|2|secondary|Finesse|Melee|d6+2 phy|1|Parry: When you are attacked, roll this weapon's damage dice. If any of the attacker's damage dice rolled the same value as your dice, the matching results are discarded from the attacker's damage dice before the damage you take is totaled.
Returning Axe|2|secondary|Agility|Close|d6+4 phy|1|Returning: When this weapon is thrown within its range, it appears in your hand immediately after the attack.
Primer Shard|2|secondary|Instinct|Very Close|d4 phy|1|Locked On: On a successful attack, your next attack against the same target with your primary weapon automatically succeeds.

Advanced Shortsword|3|secondary|Agility|Melee|d8+4 phy|1|Paired: +4 to primary weapon damage to targets within Melee range
Advanced Round Shield|3|secondary|Strength|Melee|d4+4 phy|1|Protective: +3 to Armor Score
Advanced Tower Shield|3|secondary|Strength|Melee|d6+4 phy|1|Barrier: +4 to Armor Score; −1 to Evasion
Advanced Small Dagger|3|secondary|Finesse|Melee|d8+4 phy|1|Paired: +4 to primary weapon damage to targets within Melee range
Advanced Whip|3|secondary|Presence|Very Close|d6+4 phy|1|Startling: Mark a Stress to crack the whip and force all adversaries within Melee range back to Close range.
Advanced Grappler|3|secondary|Finesse|Close|d6+4 phy|1|Hooked: On a successful attack, you can pull the target into Melee range.
Advanced Hand Crossbow|3|secondary|Finesse|Far|d6+5 phy|1|-
Buckler|3|secondary|Agility|Melee|d4+4 phy|1|Deflecting: When you are attacked, you can mark an Armor Slot to gain a bonus to your Evasion equal to your available Armor Score against the attack.
Powered Gauntlet|3|secondary|Knowledge|Close|d6+4 phy|1|Charged: Mark a Stress to gain a +1 bonus to your Proficiency on a primary weapon attack.
Hand Sling|3|secondary|Finesse|Very Far|d6+4 phy|1|Versatile: This weapon can also be used with these statistics—Finesse, Close, d8+4.

Legendary Shortsword|4|secondary|Agility|Melee|d8+6 phy|1|Paired: +5 to primary weapon damage to targets within Melee range
Legendary Round Shield|4|secondary|Strength|Melee|d4+6 phy|1|Protective: +4 to Armor Score
Legendary Tower Shield|4|secondary|Strength|Melee|d6+6 phy|1|Barrier: +5 to Armor Score; −1 to Evasion.
Legendary Small Dagger|4|secondary|Finesse|Melee|d8+6 phy|1|Paired: +5 to primary weapon damage to targets within Melee range
Legendary Whip|4|secondary|Presence|Very Close|d6+6 phy|1|Startling: Mark a Stress to crack the whip and force all adversaries within Melee range back to Close range.
Legendary Grappler|4|secondary|Finesse|Close|d6+6 phy|1|Hooked: On a successful attack, you can pull the target into Melee range.
Legendary Hand Crossbow|4|secondary|Finesse|Far|d6+7 phy|1|-
Braveshield|4|secondary|Agility|Melee|d4+6 phy|1|Sheltering: When you mark an Armor Slot, it reduces damage for you and all allies within Melee range of you who took the same damage.
Knuckle Claws|4|secondary|Strength|Melee|d6+8 phy|1|Doubled Up: When you make an attack with your primary weapon, you can deal damage to another target within Melee range.

Light-Frame Wheelchair|1|primary|Agility|Melee|d8 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Improved Light-Frame Wheelchair|2|primary|Agility|Melee|d8+3 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Advanced Light-Frame Wheelchair|3|primary|Agility|Melee|d8+6 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Legendary Light-Frame Wheelchair|4|primary|Agility|Melee|d8+9 phy|1|Quick: When you make an attack, you can mark a Stress to target another creature within range.
Heavy-Frame Wheelchair|1|primary|Strength|Melee|d12+3 phy|2|Heavy: −1 to Evasion
Improved Heavy-Frame Wheelchair|2|primary|Strength|Melee|d12+6 phy|2|Heavy: −1 to Evasion
Advanced Heavy-Frame Wheelchair|3|primary|Strength|Melee|d12+9 phy|2|Heavy: −1 to Evasion
Legendary Heavy-Frame Wheelchair|4|primary|Strength|Melee|d12+12 phy|2|Heavy: −1 to Evasion
Arcane-Frame Wheelchair|1|primary|Spellcast|Far|d6 mag|1|Reliable: +1 to attack rolls
Improved Arcane-Frame Wheelchair|2|primary|Spellcast|Far|d6+3 mag|1|Reliable: +1 to attack rolls
Advanced Arcane-Frame Wheelchair|3|primary|Spellcast|Far|d6+6 mag|1|Reliable: +1 to attack rolls
Legendary Arcane-Frame Wheelchair|4|primary|Spellcast|Far|d6+9 mag|1|Reliable: +1 to attack rolls
`;

const RANGES = {
  Melee: 'melee',
  'Very Close': 'veryClose',
  Close: 'close',
  Far: 'far',
  'Very Far': 'veryFar',
};
const DAMAGE_TYPES = { phy: 'physical', mag: 'magic', both: 'physicalOrMagic' };

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const weapons = ROWS.trim()
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((line) => {
    const [name, tier, category, trait, range, damage, burden, feature] = line.split('|');
    const m = /^d(\d+)(?:\+(\d+))?\s+(phy|mag|both)$/.exec(damage.trim());
    if (!m) throw new Error(`bad damage: ${damage} (${name})`);
    const rangeKey = RANGES[range.trim()];
    if (!rangeKey) throw new Error(`bad range: ${range} (${name})`);

    const featureText = feature.trim();
    let parsedFeature = null;
    if (featureText !== '-') {
      const idx = featureText.indexOf(': ');
      if (idx === -1) throw new Error(`bad feature: ${featureText} (${name})`);
      parsedFeature = {
        name: featureText.slice(0, idx),
        text: featureText.slice(idx + 2),
      };
    }

    return {
      id: slug(name),
      name: name.trim(),
      tier: Number(tier),
      category: category.trim(),
      trait: trait.trim().toLowerCase(),
      range: rangeKey,
      damage: { count: 1, die: Number(m[1]), modifier: m[2] ? Number(m[2]) : 0 },
      damageType: DAMAGE_TYPES[m[3]],
      burden: burden.trim() === '1' ? 'oneHanded' : 'twoHanded',
      feature: parsedFeature,
    };
  });

const ids = new Set();
for (const w of weapons) {
  if (ids.has(w.id)) throw new Error(`duplicate id: ${w.id}`);
  ids.add(w.id);
}

fs.writeFileSync(
  new URL('../data/weapons.json', import.meta.url),
  JSON.stringify(weapons, null, 2) + '\n',
);
console.log('weapons:', weapons.length);
for (const t of [1, 2, 3, 4]) {
  console.log(
    `  tier ${t}: primary ${weapons.filter((w) => w.tier === t && w.category === 'primary').length}, secondary ${weapons.filter((w) => w.tier === t && w.category === 'secondary').length}`,
  );
}
