import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

const { Movements, goals } = pathfinderPkg;

export async function goTo(bot: mineflayer.Bot, x: number, y: number, z: number, emit: (msg: string) => void): Promise<string> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await new Promise<string>((resolve) => {
      emit(`[GO] 🚶 Déplacement vers (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}) [Essai ${attempt}/${maxAttempts}]...`);

      const move = new Movements(bot);
      move.allow1by1towers = attempt > 1;
      move.canDig = attempt !== 2;
      move.allowParkour = attempt > 1;
      move.allowSprinting = attempt === 2;
      move.maxDropDown = attempt + 2;
      if (attempt === 3) move.liquidsCost = 20;

      bot.pathfinder.setMovements(move);
      bot.pathfinder.setGoal(new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1));

      let finished = false;
      let lastPosition = bot.entity.position.clone();
      
      const cleanup = () => {
        finished = true;
        clearInterval(stuckCheckInterval);
        bot.removeAllListeners("goal_reached");
        bot.removeAllListeners("path_update");
        bot.pathfinder.setGoal(null);
      };

      const timeout = setTimeout(() => {
        if (!finished) { cleanup(); resolve("timeout"); }
      }, 45000);

      const stuckCheckInterval = setInterval(() => {
        if (finished) return;
        if (bot.entity.position.distanceTo(lastPosition) < 0.3) { 
          cleanup(); clearTimeout(timeout); resolve("stuck");
        }
        lastPosition = bot.entity.position.clone();
      }, 3000);

      bot.once("goal_reached", () => {
        cleanup(); clearTimeout(timeout); resolve("succes");
      });

      bot.on("path_update", (r: any) => {
        if (r.status === "noPath") { cleanup(); clearTimeout(timeout); resolve("noPath"); }
      });
    });

    if (result === "succes") return "succes";
    if (result === "noPath" && attempt === maxAttempts) return "noPath";

    bot.clearControlStates();
    bot.setControlState('jump', true);
    await bot.waitForTicks(5);
    bot.setControlState('jump', false);
    await bot.waitForTicks(10);
  }
  return "failed";
}

export function scanForBlock(bot: mineflayer.Bot, blockNames: string[], emit: (msg: string) => void, blacklist: Set<string> = new Set()): mineflayer.Block | false {
  const matchingIds = blockNames.map(n => bot.registry.blocksByName[n]?.id).filter(id => id !== undefined);
  if (matchingIds.length === 0) return false;

  const positions = bot.findBlocks({ matching: matchingIds, maxDistance: 128, count: 128 });
  const validPositions = positions.filter(pos => !blacklist.has(`${pos.x},${pos.y},${pos.z}`));
  
  if (validPositions.length === 0) return false;

  validPositions.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b));
  return bot.blockAt(validPositions[0]) || false;
}

export async function mineBlock(bot: mineflayer.Bot, targetBlock: mineflayer.Block, preferredTools: string[] = [], emit: (msg: string) => void): Promise<string> {
  try {
    if (preferredTools.length > 0) {
      const bestTool = bot.inventory.items().find(i => preferredTools.includes(i.name));
      if (bestTool) await bot.equip(bestTool, 'hand');
    }

    emit(`[MINE] ⛏️ Cassage de ${targetBlock.name}...`);
    await Promise.race([
      bot.dig(targetBlock),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Minage trop long")), 30000))
    ]);

    return "succes";
  } catch (e: any) {
    bot.stopDigging();
    return e.message;
  }
}

export function getIngredients(bot: mineflayer.Bot, itemName: string): string[] | null {
  const item = bot.registry.itemsByName[itemName];
  if (!item || !bot.registry.recipes[item.id]?.length) return null;

  const recipe = bot.registry.recipes[item.id][0];
  const ingredients: string[] = [];

  const processEntry = (id: number | number[] | null) => {
    if (id !== null) ingredients.push(bot.registry.items[Array.isArray(id) ? id[0] : id].name);
  };

  if (recipe.inShape) recipe.inShape.flat().forEach(processEntry);
  else if (recipe.ingredients) recipe.ingredients.forEach(processEntry);

  return ingredients;
}

export async function tryCraft(bot: mineflayer.Bot, itemNames: string | string[], craftingTable: mineflayer.Block | null = null): Promise<boolean | string[]> {
  const namesToTry = Array.isArray(itemNames) ? itemNames : [itemNames];

  for (const name of namesToTry) {
    const item = bot.registry.itemsByName[name];
    if (!item) continue;

    const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, craftingTable);
        return true; 
      } catch (e) {}
    }
  }
  
  if (namesToTry.length === 1 && !Array.isArray(itemNames)) {
     return getIngredients(bot, namesToTry[0]) || [];
  }
  return false;
}

export async function placeBlock(bot: mineflayer.Bot, itemName: string, emit: (msg: string) => void): Promise<boolean> {
  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) return false;

  try {
    await bot.equip(item, 'hand');
    const nearbyBlocksPositions = bot.findBlocks({ 
      matching: (b) => !['air', 'water', 'lava'].includes(b.name) && !b.name.includes('leaves'), 
      maxDistance: 4, count: 20 
    });

    for (const pos of nearbyBlocksPositions) {
      const refBlock = bot.blockAt(pos);
      const blockAbove = bot.blockAt(pos.offset(0, 1, 0));

      if (refBlock && blockAbove?.name === 'air') {
        const dist = bot.entity.position.distanceTo(pos);
        if (dist > 1.5 && dist < 4) { 
          try {
            await bot.lookAt(pos.offset(0.5, 1, 0.5));
            await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
            return true;
          } catch (err) { continue; }
        }
      }
    }
    return false; 
  } catch (e) {
    return false;
  }
}

export async function smeltItem(bot: mineflayer.Bot, furnaceBlock: mineflayer.Block, inputName: string, count: number, emit: (msg: string) => void): Promise<boolean> {
  try {
    emit(`[FURNACE] 🚶 Rapprochement du four...`);
    await goTo(bot, furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, emit);

    emit(`[FURNACE] ♨️ Ouverture du four...`);
    const furnace = await bot.openFurnace(furnaceBlock);
    if (furnace.outputItem()) try { await furnace.takeOutput(); } catch(e) {}

    const itemToSmelt = bot.inventory.items().find(i => i.name === inputName);
    const fuel = bot.inventory.items().find(i => ["coal", "charcoal"].includes(i.name) || i.name.includes("planks") || i.name.includes("log"));

    if (!itemToSmelt || !fuel) {
        emit(`[FURNACE] ❌ Il me manque l'item à cuire ou le carburant.`);
        furnace.close();
        return false;
    }

    const fuelCountToUse = Math.min(fuel.count, fuel.name.includes("coal") ? Math.ceil(count / 8) : count);
    emit(`[FURNACE] 🧱 Placement : ${count}x ${inputName} avec ${fuelCountToUse}x ${fuel.name}...`);
    
    try {
        await furnace.putFuel(fuel.type, null, fuelCountToUse);
        await furnace.putInput(itemToSmelt.type, null, count);
    } catch (e: any) {
        emit(`[FURNACE] ⚠️ Le four est encombré ! Je le casse pour le réinitialiser.`);
        furnace.close();
        const pickaxe = bot.inventory.items().find(i => i.name.includes("pickaxe"));
        if (pickaxe) await bot.equip(pickaxe, 'hand');
        await bot.dig(furnaceBlock);
        await bot.waitForTicks(20); 
        return false; 
    }

    emit(`[FURNACE] ⏳ Cuisson en cours... (Cela va prendre un moment)`);
    let collected = 0;
    
    for (let attempts = 0; collected < count && attempts < 60; attempts++) { 
        await bot.waitForTicks(40); 
        const outItem = furnace.outputItem();
        if (outItem && outItem.count > 0) {
            await furnace.takeOutput();
            collected += outItem.count;
            emit(`[FURNACE] 🟢 Récupéré : ${collected}/${count}`);
        }
    }

    furnace.close();
    return collected >= count;
  } catch (e: any) {
    emit(`[FURNACE] ❌ Erreur matérielle avec le four : ${e.message}`);
    return false;
  }
}