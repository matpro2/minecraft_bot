import mineflayer from "mineflayer";
import { scanForBlock, goTo, explore, mineBlock, placeBlock, craftItem, smeltItem } from "./functions";
import { isFighting, executeCombat } from "./combat";


// ─────────────────────────────────────────────────────────────────────────────
// GESTION DES INTERRUPTIONS (Arrêt d'urgence)
// ─────────────────────────────────────────────────────────────────────────────
export let isInterrupted = false;

export function interruptTask(bot: any) { 
  isInterrupted = true;
  
  // 1. Arrêt des jambes de manière sécurisée
  if (bot.pathfinder) {
    bot.pathfinder.setGoal(null);
    bot.pathfinder.stop(); // Force l'arrêt de la boucle interne du pathfinder
  }
  
  // 2. Arrêt du plugin de combat
  if (bot.pvp) bot.pvp.stop();
  
  // 3. FIX DU KICK : On n'arrête le minage QUE si le bot est physiquement en train de miner
  // Sinon le serveur Minecraft reçoit un faux paquet et kick le bot !
  if (bot.targetDigBlock) {
    try { bot.stopDigging(); } catch(e) {}
  }
  
  // 4. Relâchement des touches du clavier virtuel
  bot.clearControlStates();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNAISSANCES DE L'IA
// ─────────────────────────────────────────────────────────────────────────────
export const BLOCK_TAGS: Record<string, string[]> = {
  "log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
  "planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"],
  "coal": ["coal_ore", "deepslate_coal_ore"],
  "iron": ["iron_ore", "deepslate_iron_ore"],
  "gold": ["gold_ore", "deepslate_gold_ore"],
  "diamond": ["diamond_ore", "deepslate_diamond_ore"],
  "stone": ["stone", "cobblestone", "deepslate", "cobbled_deepslate"],
  "dirt": ["dirt", "grass_block", "coarse_dirt"],
  "sand": ["sand", "red_sand"],
  "gravel": ["gravel"]
};

export const TOOL_MAPPING: Record<string, { tools: string[], required: boolean }> = {
  "stone": { tools: ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "iron": { tools: ["stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "gold": { tools: ["iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "diamond": { tools: ["iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "coal": { tools: ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "log": { tools: ["wooden_axe", "stone_axe", "iron_axe", "golden_axe", "diamond_axe", "netherite_axe"], required: false },
  "planks": { tools: ["wooden_axe", "stone_axe", "iron_axe", "golden_axe", "diamond_axe", "netherite_axe"], required: false },
  "dirt": { tools: ["wooden_shovel", "stone_shovel", "iron_shovel", "golden_shovel", "diamond_shovel", "netherite_shovel"], required: false },
  "sand": { tools: ["wooden_shovel", "stone_shovel", "iron_shovel", "golden_shovel", "diamond_shovel", "netherite_shovel"], required: false },
  "gravel": { tools: ["wooden_shovel", "stone_shovel", "iron_shovel", "golden_shovel", "diamond_shovel", "netherite_shovel"], required: false }
};

export const SMELTING_RECIPES: Record<string, string[]> = {
  "iron_ingot": ["raw_iron", "iron_ore", "deepslate_iron_ore"],
  "gold_ingot": ["raw_gold", "gold_ore", "deepslate_gold_ore"],
  "copper_ingot": ["raw_copper", "copper_ore", "deepslate_copper_ore"],
  "glass": ["sand", "red_sand"],
  "stone": ["cobblestone"]
};

const HOSTILE_MOBS = [
  "zombie", "skeleton", "creeper", "spider", "cave_spider", "drowned", "husk", 
  "stray", "phantom", "enderman", "slime", "magma_cube", "zombie_villager",
  "witch", "pillager", "vindicator", "evoker", "ravager", "hoglin", "zoglin",
  "piglin_brute", "ghast", "blaze", "wither_skeleton", "silverfish", "shulker",
  "guardian", "elder_guardian", "vex"
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPRÉHENSION (Parser)
// ─────────────────────────────────────────────────────────────────────────────
export type Command =
  | { type: "mine";     blockNames: string[]; count: number; rawName: string }
  | { type: "goCoords"; x: number; y: number; z: number }
  | { type: "goBlock";  blockNames: string[]; rawName: string }
  | { type: "craft";    itemName: string; count: number }
  | { type: "speedrun" }
  | { type: "cancel" } 
  | { type: "unknown" };

export function parseMessage(raw: string): Command {
  const msg = raw.toLowerCase().trim();

  if (msg === "speedrun") return { type: "speedrun" };
  if (msg === "cancel" || msg === "stop") return { type: "cancel" };

  const mineMatch = msg.match(/^mine\s+(.+)\s+(\d+)$/);
  if (mineMatch) {
    const rawName = mineMatch[1].trim();
    const count = parseInt(mineMatch[2], 10);
    const blockNames = BLOCK_TAGS[rawName] || [rawName.replace(/\s+/g, '_')];
    return { type: "mine", blockNames, count, rawName };
  }

  const goCoordsMatch = msg.match(/^go\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/);
  if (goCoordsMatch) {
    return { type: "goCoords", x: parseInt(goCoordsMatch[1], 10), y: parseInt(goCoordsMatch[2], 10), z: parseInt(goCoordsMatch[3], 10) };
  }

  const goBlockMatch = msg.match(/^go\s+(.+)$/);
  if (goBlockMatch) {
    const rawName = goBlockMatch[1].trim();
    const blockNames = BLOCK_TAGS[rawName] || [rawName.replace(/\s+/g, '_')];
    return { type: "goBlock", blockNames, rawName };
  }

  const craftMatch = msg.match(/^craft\s+([a-z0-9_]+)(?:\s+(\d+))?$/);
  if (craftMatch) {
    const itemName = craftMatch[1].trim();
    const count = craftMatch[2] ? parseInt(craftMatch[2], 10) : 1;
    return { type: "craft", itemName, count };
  }

  return { type: "unknown" };
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISATION DE LA DÉFENSE (Légitime Défense)
// ─────────────────────────────────────────────────────────────────────────────
export function initAI(bot: mineflayer.Bot, emit: (msg: string) => void) {
  let lastHealth = 20;

  bot.on('health', async () => {
    if (bot.health < lastHealth && !isFighting) {
      const attacker = bot.nearestEntity((e) => {
        if (e === bot.entity) return false;
        if (e.type === 'player') return false; 
        if (!e.name || !HOSTILE_MOBS.includes(e.name)) return false;
        return e.position.distanceTo(bot.entity.position) < 16;
      });

      if (attacker) {
        await executeCombat(bot, attacker, emit);
      }
    }
    lastHealth = bot.health;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉFLEXION : COLLECTE DE RESSOURCES
// ─────────────────────────────────────────────────────────────────────────────
export async function gatherResource(bot: mineflayer.Bot, blockNames: string[], count: number, emit: (msg: string) => void): Promise<number> {
  let expandedNames = new Set<string>(blockNames);
  let expandedCategory = "";
  
  for (const name of blockNames) {
    for (const [category, variants] of Object.entries(BLOCK_TAGS)) {
      if (variants.includes(name) || name === category || name.includes(category)) {
        variants.forEach(v => expandedNames.add(v));
        expandedCategory = category;
      }
    }
  }

  if (expandedNames.size > blockNames.length) {
    emit(`[BRAIN] 🔍 Généralisation de la recherche à la famille [${expandedCategory}]...`);
    blockNames = Array.from(expandedNames);
  }

  let collected = 0;
  const blacklist = new Set<string>();
  let exploreAttempts = 0;

  const getInventoryCount = () => {
    return bot.inventory.items().reduce((total, item) => {
      const match = blockNames.some(name => item.name.includes(name.replace("_ore", "")));
      return match ? total + item.count : total;
    }, 0);
  };

  while (collected < count) {
    // --- ARRÊT D'URGENCE ---
    if (isInterrupted) {
      emit(`[BRAIN] 🛑 Tâche de collecte annulée par l'utilisateur.`);
      return collected;
    }

    if (isFighting) {
      emit(`[BRAIN] 🛑 Tâche suspendue : Le bot est en combat !`);
      while (isFighting) {
        if (isInterrupted) return collected; // Sécurité supplémentaire
        await new Promise(r => setTimeout(r, 1000));
      }
      emit(`[BRAIN] ▶️ Combat terminé, reprise de la tâche...`);
    }

    emit(`[BRAIN] Progression objectif : ${collected}/${count}`);
    
    const toolData = TOOL_MAPPING[expandedCategory];
    let availableTools: string[] = [];
    
    if (toolData) {
      availableTools = toolData.tools;
      const hasTool = bot.inventory.items().some(item => availableTools.includes(item.name));
      
      if (toolData.required && !hasTool) {
        emit(`[BRAIN] ⚠️ Outil adéquat manquant pour [${expandedCategory}]. Je refuse de miner à la main.`);
        const lowestTool = availableTools[0]; 
        emit(`[BRAIN] 💡 Lancement du protocole d'auto-craft pour un(e) ${lowestTool}...`);
        
        const toolCrafted = await autoCraft(bot, lowestTool, 1, emit);
        if (!toolCrafted) {
          emit(`[BRAIN] ❌ Impossible de fabriquer l'outil. Abandon de la collecte de ${expandedCategory}.`);
          break; 
        }
      }
    }

    const targetBlock = scanForBlock(bot, blockNames, emit, blacklist);

    if (!targetBlock) {
      if (exploreAttempts >= 5) {
        emit(`[BRAIN] ❌ Zone totalement épuisée. Abandon de la collecte.`);
        break; 
      }
      emit(`[BRAIN] 🔍 Zone vide. Déclenchement de l'exploration (Tentative ${exploreAttempts + 1}/5)...`);
      await explore(bot, 20, emit);
      exploreAttempts++;
      continue; 
    }

    exploreAttempts = 0;
    const countBefore = getInventoryCount();
    
    const actionSuccess = await mineBlock(bot, targetBlock, availableTools, emit);

    if (!actionSuccess) {
      emit(`[BRAIN] ⚠️ Bloc inaccessible ou erreur de minage. Ajout à la liste noire.`);
      blacklist.add(`${targetBlock.position.x},${targetBlock.position.y},${targetBlock.position.z}`);
      continue;
    }

    const countAfter = getInventoryCount();
    if (countAfter > countBefore) {
      collected += (countAfter - countBefore);
      emit(`[BRAIN] ✅ Ressource acquise. (${collected}/${count})`);
    } else {
      emit(`[BRAIN] ⚠️ Bloc détruit mais ressource perdue. Je l'ignore.`);
      blacklist.add(`${targetBlock.position.x},${targetBlock.position.y},${targetBlock.position.z}`);
    }
  }

  return collected;
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉFLEXION : FABRICATION (AutoCraft & Fonderie)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// RÉFLEXION : FABRICATION (AutoCraft & Fonderie)
// ─────────────────────────────────────────────────────────────────────────────
export async function autoCraft(bot: mineflayer.Bot, itemName: string, amount: number, emit: (msg: string) => void): Promise<boolean> {
  if (isInterrupted) return false;

  if (itemName.includes("_planks") || itemName.includes("_log")) {
    const tempItem = bot.registry.itemsByName[itemName];
    const currentCount = tempItem ? bot.inventory.count(tempItem.id, null) : 0;
    
    if (currentCount < amount) {
      const woodIds = BLOCK_TAGS["log"].map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
      const woodBlock = bot.findBlock({ matching: woodIds, maxDistance: 64 }); 
      
      if (woodBlock) {
        const prefix = woodBlock.name.replace("_log", "").replace("_stem", "");
        const newName = itemName.includes("_planks") ? `${prefix}_planks` : `${prefix}_log`;
        
        if (newName !== itemName && bot.registry.itemsByName[newName]) {
          emit(`[BRAIN] 🌲 Adaptation : Remplacement de ${itemName} par ${newName} (bois local).`);
          itemName = newName;
        }
      }
    }
  }

  const item = bot.registry.itemsByName[itemName];
  if (!item) {
    const tags = BLOCK_TAGS[itemName];
    if (tags && tags.length > 0) return await autoCraft(bot, tags[0], amount, emit);
    return false;
  }

  const currentCount = bot.inventory.count(item.id, null);
  if (currentCount >= amount) return true;

  const missing = amount - currentCount;

  // GESTION DU FOUR (Cuisson)
  if (SMELTING_RECIPES[itemName]) {
    emit(`[BRAIN] 🔥 ${itemName} s'obtient par cuisson. Lancement du protocole de fonderie...`);
    const rawMaterials = SMELTING_RECIPES[itemName];
    
    let rawCount = 0;
    let availableRawItem = "";
    
    for (const raw of rawMaterials) {
      const id = bot.registry.itemsByName[raw]?.id;
      if (id) {
          const count = bot.inventory.count(id, null);
          rawCount += count;
          if (count > 0) availableRawItem = raw;
      }
    }

    if (rawCount < missing) {
      const tag = itemName.replace("_ingot", ""); 
      emit(`[BRAIN] ⛏️ Matière première manquante. Collecte de [${tag}]...`);
      await gatherResource(bot, [tag], missing - rawCount, emit);
      if (isInterrupted) return false;
      
      for (const raw of rawMaterials) {
        const id = bot.registry.itemsByName[raw]?.id;
        if (id && bot.inventory.count(id, null) >= missing) {
            availableRawItem = raw;
            break;
        }
      }
    }

    if (!availableRawItem) {
       emit(`[BRAIN] ❌ Impossible de rassembler assez de matières premières pour ${itemName}.`);
       return false;
    }

    let fuelCount = bot.inventory.items().filter(i => i.name === "coal" || i.name === "charcoal").reduce((acc, i) => acc + i.count, 0);
    if (fuelCount < Math.ceil(missing / 8)) {
       emit(`[BRAIN] ⛏️ Carburant insuffisant. Collecte de charbon...`);
       await gatherResource(bot, ["coal"], Math.ceil(missing / 8) - fuelCount, emit);
       if (isInterrupted) return false;
    }

    // --- NOUVELLE INTELLIGENCE : BOUCLE DE RÉSILIENCE POUR LE FOUR ---
    let smeltAttempts = 0;
    
    while (smeltAttempts < 3) {
      if (isInterrupted) return false;

      let furnaceBlock = scanForBlock(bot, ["furnace"], emit);
      
      if (!furnaceBlock) {
          const hasFurnace = bot.inventory.items().some(i => i.name === "furnace");
          
          if (!hasFurnace) {
              emit(`[BRAIN] 🧱 Je n'ai pas de four. Je vais en fabriquer un.`);
              const furnaceCrafted = await autoCraft(bot, "furnace", 1, emit);
              if (!furnaceCrafted || isInterrupted) return false;
          } else {
              emit(`[BRAIN] 🧱 J'ai un four dans mon inventaire, je vais le poser.`);
          }
          
          const placed = await placeBlock(bot, "furnace", emit);
          if (!placed) return false; // Si on ne peut vraiment pas le poser, on abandonne
          
          // Laisse une petite seconde au serveur pour bien faire apparaître le four
          await new Promise(r => setTimeout(r, 500));
          furnaceBlock = scanForBlock(bot, ["furnace"], emit);
      }

      if (!furnaceBlock) return false;

      // On tente la cuisson
      const smeltSuccess = await smeltItem(bot, furnaceBlock, availableRawItem, missing, emit);
      
      // Si la cuisson réussit, on valide et on sort de la fonction !
      if (smeltSuccess) return true;

      // Si la cuisson échoue (ex: le four était bouché et le bot l'a cassé), on boucle !
      emit(`[BRAIN] 🔄 Cuisson interrompue ou four encombré. Je me réorganise... (${smeltAttempts + 1}/3)`);
      smeltAttempts++;
      await new Promise(r => setTimeout(r, 1500)); // Petite pause pour reprendre ses esprits
    }
    
    emit(`[BRAIN] ❌ Impossible de cuire les items après 3 tentatives.`);
    return false;
  }

  // GESTION DU CRAFT MANUEL / ETABLI
  const recipes = bot.registry.recipes[item.id];

  if (!recipes || recipes.length === 0) {
    emit(`[BRAIN] ⛏️ ${itemName} est une matière première. Lancement de la collecte...`);
    const mined = await gatherResource(bot, [itemName], missing, emit);
    if (isInterrupted) return false;
    
    await new Promise(r => setTimeout(r, 800)); 
    
    if (mined < missing) {
      emit(`[BRAIN] ❌ Échec : Ressource insuffisante (${itemName}).`);
      return false;
    }
    return true;
  }

  const recipeDef = recipes[0];
  const yields = recipeDef.result?.count || 1;
  const craftsNeeded = Math.ceil(missing / yields);

  const requiresTable = recipeDef.inShape && (recipeDef.inShape.length > 2 || recipeDef.inShape[0].length > 2);
  let craftingTable = null;
  
  if (requiresTable) {
    craftingTable = scanForBlock(bot, ["crafting_table"], emit);
    
    if (!craftingTable) {
      const hasTable = bot.inventory.items().some(i => i.name === "crafting_table");
      
      if (!hasTable) {
        emit(`[BRAIN] 🪵 J'ai besoin d'un établi. Je vais en crafter un.`);
        const tableSuccess = await autoCraft(bot, "crafting_table", 1, emit);
        if (!tableSuccess || isInterrupted) return false;
      } else {
        emit(`[BRAIN] 🪵 J'ai récupéré un établi, je vais le poser par terre.`);
      }
      
      const placed = await placeBlock(bot, "crafting_table", emit);
      
      if (!placed) {
        emit(`[BRAIN] ⚠️ Impossible de poser l'établi ici (pas de place).`);
        return false;
      }
      
      await new Promise(r => setTimeout(r, 500));
      craftingTable = scanForBlock(bot, ["crafting_table"], emit);
    }
    
    if (craftingTable) {
      const reached = await goTo(bot, craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, emit);
      if (!reached || isInterrupted) return false;
    } else {
      return false;
    }
  }

  let ingredientsReady = false;
  let safetyLoop = 0; 
  
  while (!ingredientsReady && safetyLoop < 5) {
    if (isInterrupted) return false; 
    
    ingredientsReady = true;
    const requiredIngredients: Record<number, number> = {};
    
    const processIngredient = (ing: any) => {
      if (ing === null) return;
      let selectedId: number | null = null;

      if (Array.isArray(ing)) selectedId = ing[0];
      else if (typeof ing === 'number') selectedId = ing;
      else if (typeof ing === 'object' && ing.id) selectedId = ing.id;

      if (selectedId !== null) {
        const itemObj = bot.registry.items[selectedId];
        if (itemObj) {
          const name = itemObj.name;
          let substitutionFound = false;
          
          for (const [category, variants] of Object.entries(BLOCK_TAGS)) {
            if (variants.includes(name) || name.includes(category)) {
              for (const variantName of variants) {
                const variantId = bot.registry.itemsByName[variantName]?.id;
                if (variantId && bot.inventory.count(variantId, null) > 0) {
                  selectedId = variantId; 
                  substitutionFound = true;
                  break;
                }
              }
            }
            if (substitutionFound) break; 
          }
        }
        requiredIngredients[selectedId] = (requiredIngredients[selectedId] || 0) + 1;
      }
    };

    if (recipeDef.inShape) recipeDef.inShape.forEach((row: any[]) => row.forEach(processIngredient));
    else if (recipeDef.ingredients) recipeDef.ingredients.forEach(processIngredient);

    for (const [idStr, qty] of Object.entries(requiredIngredients)) {
      const ingId = parseInt(idStr, 10);
      const ingItem = bot.registry.items[ingId];
      const totalNeeded = qty * craftsNeeded;
      const inInventory = bot.inventory.count(ingId, null);
      
      if (inInventory < totalNeeded) {
        ingredientsReady = false; 
        emit(`[BRAIN] 🔄 Ingrédient manquant : ${ingItem.name} (${inInventory}/${totalNeeded}).`);
        const success = await autoCraft(bot, ingItem.name, totalNeeded, emit);
        if (!success || isInterrupted) {
          emit(`[BRAIN] ❌ Impossible d'obtenir l'ingrédient : ${ingItem.name}`);
          return false;
        }
        break; 
      }
    }
    safetyLoop++;
  }

  if (!ingredientsReady || isInterrupted) return false;

  if (requiresTable && craftingTable) {
    const dist = bot.entity.position.distanceTo(craftingTable.position);
    if (dist > 3) {
      emit(`[BRAIN] 🚶 Retour vers l'établi...`);
      const returned = await goTo(bot, craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, emit);
      if (!returned || isInterrupted) return false;
    }
  }

  await new Promise(r => setTimeout(r, 800)); 
  const availableRecipes = bot.recipesFor(item.id, null, 1, craftingTable || null);
  
  if (availableRecipes.length === 0) {
    emit(`[BRAIN] ❌ Craft impossible : Recette non reconnue ou établi trop loin.`);
    return false;
  }

  const craftSuccess = await craftItem(bot, availableRecipes[0], craftsNeeded, craftingTable || null, emit);
  if (craftSuccess) emit(`[BRAIN] ✅ ${itemName} fabriqué avec succès !`);
  
  return craftSuccess;
}

// ─────────────────────────────────────────────────────────────────────────────
// MACRO : SPEEDRUN ROUTINE
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// MACRO : SPEEDRUN ROUTINE (Optimisée en Batching)
// ─────────────────────────────────────────────────────────────────────────────
export async function executeSpeedrun(bot: mineflayer.Bot, emit: (msg: string) => void): Promise<void> {
  
  // On définit une liste d'actions séquentielles ultra-optimisées
  // "craft" : Fabrique un item s'il n'est pas déjà possédé
  // "gather" : Fait une session de minage groupée pour anticiper les prochains crafts
  const tasks: Array<{ action: "craft" | "gather", item?: string, tags?: string[], count?: number, desc?: string }> = [
    // --- ÉTAPE 1 : L'ÂGE DE BOIS ---
    { action: "craft", item: "wooden_axe" },
    { action: "craft", item: "wooden_pickaxe" },
    { action: "craft", item: "wooden_sword" },
    { action: "craft", item: "wooden_shovel" },

    // --- ÉTAPE 2 : L'ÂGE DE PIERRE ---
    { action: "craft", item: "stone_pickaxe" },
    // L'astuce opti : on pré-mine 6 pierres d'un coup (3 hache, 2 épée, 1 pelle)
    { action: "gather", tags: ["stone"], count: 6, desc: "pierre (pour hache, épée, pelle)" },
    { action: "gather", tags: ["log"], count: 2, desc: "bois (réserve pour les manches)" },
    { action: "craft", item: "stone_axe" },
    { action: "craft", item: "stone_sword" },
    { action: "craft", item: "stone_shovel" },

    // --- ÉTAPE 3 : L'ÂGE DE FER (Outils) ---
    { action: "craft", item: "iron_pickaxe" },
    // On pré-mine 6 fers d'un coup
    { action: "gather", tags: ["iron"], count: 6, desc: "fer (pour hache, épée, pelle)" },
    { action: "gather", tags: ["log"], count: 2, desc: "bois (réserve pour les manches)" },
    // OPTIMISATION : On demande le craft de 6 lingots direct, pour qu'il cuise tout d'un coup dans le four !
    { action: "craft", item: "iron_ingot", count: 6 },
    { action: "craft", item: "iron_axe" },
    { action: "craft", item: "iron_sword" },
    { action: "craft", item: "iron_shovel" },

    // --- ÉTAPE 4 : L'ÂGE DE FER (Armures) ---
    // 24 fers (casque=5, plastron=8, pantalon=7, bottes=4)
    { action: "gather", tags: ["iron"], count: 24, desc: "fer (pour l'armure complète)" },
    { action: "gather", tags: ["coal"], count: 6, desc: "charbon (pour la cuisson du fer)" },
    { action: "craft", item: "iron_ingot", count: 24 }, // Cuisson de masse
    { action: "craft", item: "iron_helmet" },
    { action: "craft", item: "iron_chestplate" },
    { action: "craft", item: "iron_leggings" },
    { action: "craft", item: "iron_boots" }
  ];

  emit(`[SPEEDRUN] 🏁 Lancement du protocole d'automatisation optimisé !`);

  for (const task of tasks) {
    if (isInterrupted) return; // Arrêt d'urgence

    if (task.action === "craft") {
      const itemName = task.item!;
      const amountNeeded = task.count || 1;
      
      const itemInfo = bot.registry.itemsByName[itemName];
      if (itemInfo && bot.inventory.count(itemInfo.id, null) >= amountNeeded) {
        emit(`[SPEEDRUN] ✔️ Je possède déjà assez de ${itemName}.`);
        continue;
      }

      emit(`[SPEEDRUN] 🛠️ Fabrication de ${amountNeeded}x ${itemName}...`);
      const success = await autoCraft(bot, itemName, amountNeeded, emit);
      
      if (!success || isInterrupted) {
        emit(`[SPEEDRUN] ❌ Échec ou annulation lors du craft de ${itemName}.`);
        return; 
      }
    } 
    else if (task.action === "gather") {
      const tags = task.tags!;
      const needed = task.count!;
      
      // Vérification intelligente de l'inventaire avant de miner pour rien
      const expandedNames = new Set<string>();
      for (const name of tags) {
         const variants = BLOCK_TAGS[name];
         if (variants) variants.forEach(v => expandedNames.add(v));
         else expandedNames.add(name);
      }
      
      const currentCount = bot.inventory.items().reduce((total, item) => {
         const match = Array.from(expandedNames).some(n => item.name.includes(n.replace("_ore", "")));
         return match ? total + item.count : total;
      }, 0);

      const missing = needed - currentCount;
      if (missing > 0) {
        emit(`[SPEEDRUN] ⛏️ Collecte groupée : ${missing}x ${task.desc}...`);
        await gatherResource(bot, tags, missing, emit);
        if (isInterrupted) return;
      } else {
        emit(`[SPEEDRUN] ✔️ Inventaire suffisant pour : ${task.desc}.`);
      }
    }
  }

  emit(`[SPEEDRUN] 🏆 GGG ! Speedrun optimisé terminé avec succès !`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXÉCUTION (Routeur principal)
// ─────────────────────────────────────────────────────────────────────────────
export async function executeCommand(bot: mineflayer.Bot, command: Command, emitLog: (msg: string) => void) {
  isInterrupted = false; // Réinitialise l'état au lancement d'une nouvelle commande valide

  switch (command.type) {
    case "speedrun":
      bot.chat(`Mode Speedrun activé. Que la course commence !`);
      await executeSpeedrun(bot, emitLog);
      bot.chat(`Protocole Speedrun terminé ou interrompu.`);
      break;
      
    case "mine":
      bot.chat(`Ordre reçu. Je collecte ${command.count}x ${command.rawName}...`);
      await gatherResource(bot, command.blockNames, command.count, emitLog);
      bot.chat(`Mission terminée.`);
      break;
      
    case "goCoords":
      bot.chat(`En route vers [${command.x}, ${command.y}, ${command.z}]...`);
      await goTo(bot, command.x, command.y, command.z, emitLog);
      break;
      
    case "goBlock":
      bot.chat(`Je cherche un(e) ${command.rawName}...`);
      const target = scanForBlock(bot, command.blockNames, emitLog);
      if (target) {
        await goTo(bot, target.position.x, target.position.y, target.position.z, emitLog);
        bot.chat(`Je suis arrivé.`);
      } else {
        bot.chat(`Je n'en trouve pas autour de moi.`);
      }
      break;
      
    case "craft":
      bot.chat(`Lancement de la chaîne de fabrication pour : ${command.itemName}...`);
      const success = await autoCraft(bot, command.itemName, command.count, emitLog);
      if (success) bot.chat(`Fabrication réussie !`);
      else bot.chat(`J'ai rencontré un problème durant la fabrication.`);
      break;
  }
}