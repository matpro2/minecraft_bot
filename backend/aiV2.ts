import mineflayer from "mineflayer";
import { goTo, mineBlock, scanForBlock, getIngredients, tryCraft, placeBlock, smeltItem } from "./functionsV2";

export const BLOCK_TAGS: Record<string, string[]> = {
  "log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"],
  "planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"],
  "stone": ["stone", "cobblestone", "deepslate", "cobbled_deepslate"],
  "dirt": ["dirt", "grass_block", "coarse_dirt"],
  "sand": ["sand", "red_sand"],
  "gravel": ["gravel"]
};

export const ITEM_TO_BLOCK: Record<string, string[]> = {
  "raw_iron": ["iron_ore", "deepslate_iron_ore"],
  "iron": ["iron_ore", "deepslate_iron_ore"],  
  "raw_gold": ["gold_ore", "deepslate_gold_ore"],
  "gold": ["gold_ore", "deepslate_gold_ore"],
  "raw_copper": ["copper_ore", "deepslate_copper_ore"],
  "copper": ["copper_ore", "deepslate_copper_ore"],
  "coal": ["coal_ore", "deepslate_coal_ore"],
  "diamond": ["diamond_ore", "deepslate_diamond_ore"],
  "emerald": ["emerald_ore", "deepslate_emerald_ore"],
  "redstone": ["redstone_ore", "deepslate_redstone_ore"],
  "lapis_lazuli": ["lapis_ore", "deepslate_lapis_ore"],
  "quartz": ["nether_quartz_ore"]
};

export const TOOL_MAPPING: Record<string, { tools: string[], required: boolean }> = {
  "stone": { tools: ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "obsidian": { tools: ["wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "iron": { tools: ["stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "copper": { tools: ["stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "gold": { tools: ["iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "diamond": { tools: ["iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "emerald": { tools: ["iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
  "redstone": { tools: ["iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe"], required: true },
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

export type Command =
  | { type: "mine"; blockNames: string[]; count: number; rawName: string }
  | { type: "goCoords"; x: number; y: number; z: number }
  | { type: "goBlock"; blockNames: string[]; rawName: string }
  | { type: "craft"; itemName: string; count: number }
  | { type: "get"; itemName: string; amount: number }
  | { type: "speedrun" }
  | { type: "cancel" } 
  | { type: "start" } 
  | { type: "unknown" };

function getVariants(itemName: string): string[] {
  for (const [tag, items] of Object.entries(BLOCK_TAGS)) {
    if (items.includes(itemName) || tag === itemName) return items;
  }
  return [itemName];
}

function countInInventory(bot: mineflayer.Bot, variants: string[]): number {
  return variants.reduce((sum, v) => {
    const item = bot.inventory.items().find(i => i.name === v);
    return sum + (item ? item.count : 0);
  }, 0);
}

function getBlockTargets(rawName: string): string[] {
  return ITEM_TO_BLOCK[rawName] || BLOCK_TAGS[rawName] || [rawName.replace(/\s+/g, '_')];
}

export function parseMessage(raw: string): Command {
  const msg = raw.toLowerCase().trim();

  if (msg === "speedrun") return { type: "speedrun" };
  if (msg === "cancel" || msg === "stop") return { type: "cancel" };
  if (msg === "start") return { type: "start" };

  const mineMatch = msg.match(/^mine\s+(.+)\s+(\d+)$/);
  if (mineMatch) {
    const rawName = mineMatch[1].trim();
    return { type: "mine", blockNames: getBlockTargets(rawName), count: parseInt(mineMatch[2], 10), rawName };
  }

  const goCoordsMatch = msg.match(/^go\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/);
  if (goCoordsMatch) return { type: "goCoords", x: parseInt(goCoordsMatch[1], 10), y: parseInt(goCoordsMatch[2], 10), z: parseInt(goCoordsMatch[3], 10) };

  const goBlockMatch = msg.match(/^go\s+(.+)$/);
  if (goBlockMatch) {
    const rawName = goBlockMatch[1].trim();
    return { type: "goBlock", blockNames: getBlockTargets(rawName), rawName };
  }

  const craftMatch = msg.match(/^craft\s+([a-z0-9_]+)(?:\s+(\d+))?$/);
  if (craftMatch) return { type: "craft", itemName: craftMatch[1].trim(), count: craftMatch[2] ? parseInt(craftMatch[2], 10) : 1 };

  const getMatch = msg.match(/^get\s+([a-z0-9_]+)(?:\s+(\d+))?$/);
  if (getMatch) return { type: "get", itemName: getMatch[1], amount: parseInt(getMatch[2] || "1", 10) };

  return { type: "unknown" };
}

async function getOrPlaceStation(bot: mineflayer.Bot, stationName: string, emit: any, history: string[]): Promise<mineflayer.Block | null> {
  let target = scanForBlock(bot, [stationName], emit);
  if (target && typeof target !== "string") return target;

  if (!bot.inventory.items().some(i => i.name === stationName)) {
    emit(`[GET] 🧱 ${stationName} manquant. Lancement du sous-objectif...`);
    await performGet(bot, stationName, 1, emit, history);
  }

  if (bot.inventory.items().some(i => i.name === stationName)) {
    emit(`[GET] 🧱 Pose de ${stationName}...`);
    await placeBlock(bot, stationName, emit);
    await bot.waitForTicks(15);
    const newTarget = scanForBlock(bot, [stationName], emit);
    if (newTarget && typeof newTarget !== "string") return newTarget;
  }
  return null;
}

async function performGet(bot: mineflayer.Bot, itemName: string, amount: number, emit: any, history: string[] = []): Promise<void> {
  const variants = getVariants(itemName);
  const currentCount = countInInventory(bot, variants);

  if (currentCount >= amount) {
    emit(`[GET] ✅ J'ai déjà assez de ${variants[0]} (ou équivalent) : ${currentCount}/${amount}.`);
    return; 
  }

  emit(`[GET] 🤔 Analyse pour obtenir ${amount}x ${itemName}...`);

  if (SMELTING_RECIPES[itemName]) {
    const rawMaterials = SMELTING_RECIPES[itemName];
    emit(`[GET] 🔥 Objet à cuire détecté. Matières premières possibles : ${rawMaterials.join(", ")}`);

    const selectedRaw = rawMaterials.find(raw => bot.inventory.items().some(i => i.name === raw)) || rawMaterials[0];
    
    emit(`[GET] ⛏️ Objectif Matière Première : ${amount}x ${selectedRaw}`);
    await performGet(bot, selectedRaw, amount, emit, [...history, itemName]);

    const fuelNeeded = Math.ceil(amount / 8); 
    emit(`[GET] ⛽ Objectif Combustible : ${fuelNeeded}x coal`);
    await performGet(bot, "coal", fuelNeeded, emit, [...history, itemName]);

    const furnaceBlock = await getOrPlaceStation(bot, "furnace", emit, [...history, itemName]);
    if (!furnaceBlock) {
      emit(`[GET] ❌ Échec : Impossible d'accéder à un four posé.`);
      return;
    }

    emit(`[GET] 🔥 Lancement de la cuisson...`);
    if (await smeltItem(bot, furnaceBlock, selectedRaw, amount, emit)) {
      emit(`[GET] ✨ Cuisson réussie pour : ${itemName}`);
    } else {
      emit(`[GET] ❌ Échec de la cuisson. Re-analyse...`);
      return await performGet(bot, itemName, amount, emit, history); 
    }
    return; 
  }

  const ingredients = getIngredients(bot, itemName);
  const testItemDef = bot.registry.itemsByName[variants[0]];
  const recipeDef = testItemDef?.id ? bot.registry.recipes[testItemDef.id]?.[0] : null;
  const isLooping = history.includes(itemName);

  if (isLooping) emit(`[GET] 🛡️ Boucle de craft détectée pour ${itemName}. Je passe à la méthode naturelle.`);

  if (ingredients && recipeDef && !isLooping && !ITEM_TO_BLOCK[itemName]) {
    const yields = recipeDef.result?.count || 1;
    const craftsNeeded = Math.ceil((amount - currentCount) / yields); 
    const requiredCounts: Record<string, number> = {};
    
    ingredients.forEach(ing => requiredCounts[ing] = (requiredCounts[ing] || 0) + craftsNeeded);
    emit(`[GET] 🛠️ Objet craftable. Besoin de ${craftsNeeded} craft(s). Ingrédients : ${Object.entries(requiredCounts).map(([k, v]) => `${v}x ${k}`).join(", ")}`);
    
    let ingredientsReady = false;
    for (let i = 0; i < 10 && !ingredientsReady; i++) {
      ingredientsReady = true;
      for (const [ingName, requiredQty] of Object.entries(requiredCounts)) {
        const currentIngCount = countInInventory(bot, getVariants(ingName));
        if (currentIngCount < requiredQty) {
          ingredientsReady = false;
          emit(`[GET] 🔄 Oups ! Il me manque des ${ingName} (${currentIngCount}/${requiredQty}). Je retourne en chercher.`);
          await performGet(bot, ingName, requiredQty, emit, [...history, itemName]);
          break; 
        }
      }
    }

    if (!ingredientsReady) {
      emit(`[GET] ❌ Échec : Impossible de réunir tous les ingrédients simultanément.`);
      return;
    }

    let craftingTableBlock: mineflayer.Block | null = null;
    const requiresTable = recipeDef.requiresTable ?? ((recipeDef.inShape && (recipeDef.inShape.length > 2 || recipeDef.inShape[0].length > 2)) || (recipeDef.ingredients && recipeDef.ingredients.length > 4));

    if (requiresTable && !variants.includes("crafting_table")) {
      emit(`[GET] 🪵 Cette recette nécessite un établi.`);
      craftingTableBlock = await getOrPlaceStation(bot, "crafting_table", emit, [...history, itemName]);
      if (craftingTableBlock) {
        emit(`[GET] 🚶 Rapprochement de l'établi...`);
        await goTo(bot, craftingTableBlock.position.x, craftingTableBlock.position.y, craftingTableBlock.position.z, emit);
      } else {
        emit(`[GET] ❌ Échec : Impossible d'accéder à un établi posé.`);
        return;
      }
    }

    for (const [ingName, requiredQty] of Object.entries(requiredCounts)) {
      if (countInInventory(bot, getVariants(ingName)) < requiredQty) {
        emit(`[GET] ⚠️ Vérification finale échouée pour ${ingName}. Je relance.`);
        await performGet(bot, ingName, requiredQty, emit, [...history, itemName]);
        return await performGet(bot, itemName, amount, emit, history);
      }
    }

    emit(`[GET] 🔨 Fabrication en cours...`);
    let craftsSucceeded = 0;
    for (let i = 0; i < craftsNeeded; i++) {
      if (await tryCraft(bot, variants, craftingTableBlock)) craftsSucceeded++;
    }
    
    if (craftsSucceeded > 0) emit(`[GET] ✨ Craft réussi pour la famille : ${itemName} (x${craftsSucceeded * yields} obtenus)`);
    else {
      emit(`[GET] ❌ Échec du craft. Re-analyse des ressources...`);
      return await performGet(bot, itemName, amount, emit, history);
    }
  } else {
    emit(`[GET] 🌲 Objet naturel détecté. Lancement du scan pour la famille...`);
    
    let category = Object.keys(BLOCK_TAGS).find(tag => BLOCK_TAGS[tag].includes(itemName) || tag === itemName) || itemName;
    const baseMapping = ["iron", "gold", "copper", "coal", "diamond", "emerald", "redstone", "lapis_lazuli", "quartz"];
    const matchedBase = baseMapping.find(base => itemName.includes(base));
    if (matchedBase) category = matchedBase;

    const toolData = TOOL_MAPPING[category];
    let preferredTools: string[] = [];

    if (toolData) {
      preferredTools = toolData.tools;
      if (toolData.required && !bot.inventory.items().some(i => preferredTools.includes(i.name))) {
        const lowestTool = preferredTools[0]; 
        emit(`[GET] ⚠️ Cet objet nécessite un outil. Sous-objectif : obtenir 1x ${lowestTool}.`);
        await performGet(bot, lowestTool, 1, emit, [...history, itemName]);
        if (!bot.inventory.items().some(i => preferredTools.includes(i.name))) {
          emit(`[GET] ❌ Échec critique : Je n'ai pas pu obtenir l'outil nécessaire (${lowestTool}).`);
          return;
        }
      }
    }

    let collected = currentCount;
    let scanAttempts = 0;
    const blocksToScan = ITEM_TO_BLOCK[itemName] || variants;
    
    if (ITEM_TO_BLOCK[itemName]) emit(`[GET] 💡 Traduction de l'item en bloc pour le scan : ${itemName} -> ${blocksToScan[0]}`);

    while (collected < amount && scanAttempts < 5) {
      const target = scanForBlock(bot, blocksToScan, emit);  
      if (target && typeof target !== "string") {
        emit(`[GET] 🚶 Cible trouvée (${target.name}). Déplacement...`);
        await goTo(bot, target.position.x, target.position.y, target.position.z, emit);
        await mineBlock(bot, target, preferredTools, emit);
        await bot.waitForTicks(20); 
        collected = countInInventory(bot, variants);
      } else {
        emit(`[GET] ❌ Impossible de trouver ça à proximité.`);
        break;
      }
      scanAttempts++;
    }
  }
}

export async function executeCommand(bot: mineflayer.Bot, command: Command, emit: (msg: string) => void) {
  switch (command.type) {
    case "goCoords":      
      emit(await goTo(bot, command.x, command.y, command.z, emit));
      break;

    case "mine":
      bot.chat(`Je cherche ${command.rawName}...`);
      const targetBlock = scanForBlock(bot, command.blockNames, emit);
      if (targetBlock && typeof targetBlock !== "string") {
        await goTo(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, emit);
        emit(`[MINE] Résultat: ${await mineBlock(bot, targetBlock, [], emit)}`);
      } else {
        bot.chat(`Je ne trouve pas ce bloc.`);
      }
      break;

    case "get":
      bot.chat(`Objectif : Obtenir ${command.itemName}`);
      await performGet(bot, command.itemName, command.amount, emit, []);
      bot.chat(`Tâche terminée.`);
      break;

    case "craft":
      bot.chat(`Je tente de crafter : ${command.itemName}...`);
      const craftResult = await tryCraft(bot, command.itemName);

      if (craftResult === true) {
        bot.chat(`Succès ! J'ai fabriqué ${command.itemName}.`);
      } else {
        bot.chat(`Échec. Il me manque : ${craftResult.join(", ")}`);
        for (const missingItem of craftResult as string[]) {
          bot.chat(`Je pars chercher : ${missingItem}`);
          const blockToSearch = (missingItem.includes("planks") || missingItem === "stick") ? BLOCK_TAGS["log"] : [missingItem];
          const target = scanForBlock(bot, blockToSearch, emit);
          if (!target || typeof target === "string") {
            bot.chat(`Je ne trouve pas de ça autour de moi.`);
            continue; 
          }
          await goTo(bot, target.position.x, target.position.y, target.position.z, emit);
          await mineBlock(bot, target, [], emit);
          await bot.waitForTicks(20); 
        }

        bot.chat(`J'ai fini de récolter, je retente le craft...`);
        if (await tryCraft(bot, command.itemName) === true) bot.chat(`Super ! Réussi à la deuxième tentative.`);
        else bot.chat(`Toujours pas... Il me manque encore des choses ou un établi.`);
      }
      break;
  }
}