import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

const { Movements, goals } = pathfinderPkg;

// ─────────────────────────────────────────────────────────────────────────────
// 1. DÉPLACEMENT (Navigation simple)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tente d'aller à des coordonnées précises avec des mouvements propres.
 * @returns {Promise<boolean>} true si arrivé, false si chemin bloqué.
 */
export async function goTo(bot: mineflayer.Bot, x: number, y: number, z: number, emit: (msg: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    emit(`[GO] 🚶 Déplacement vers (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})...`);
    
    const move = new Movements(bot);
    move.allow1by1towers = false;
    move.canDig = true;
    move.maxDropDown = 2;
    
    bot.pathfinder.setMovements(move);
    bot.pathfinder.setGoal(new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1));

    let finished = false;

    // Fonction de nettoyage pour éviter les fuites de mémoire (Memory Leaks)
    const cleanup = () => {
      finished = true;
      bot.removeListener("goal_reached", onGoalReached);
      bot.removeListener("path_update", onPathUpdate);
      bot.removeListener("goal_updated", onGoalUpdated);
    };

    const timeout = setTimeout(() => {
      if (finished) return;
      bot.pathfinder.setGoal(null);
      emit(`[GO] ⚠️ Le trajet prend trop de temps.`);
      cleanup();
      resolve(false);
    }, 60000);

    const onGoalReached = () => {
      clearTimeout(timeout);
      cleanup();
      emit(`[GO] ✅ Arrivé à destination.`);
      resolve(true);
    };

    const onPathUpdate = (r: any) => {
      if (r.status === "noPath") {
        clearTimeout(timeout);
        cleanup();
        emit(`[GO] ❌ Aucun chemin possible.`);
        resolve(false);
      }
    };

    // L'ÉCOUTEUR MAGIQUE : Se déclenche quand on tape "cancel" (setGoal(null))
    const onGoalUpdated = (goal: any) => {
      if (goal === null) {
        clearTimeout(timeout);
        cleanup();
        resolve(false); // On quitte proprement la fonction
      }
    };

    bot.on("goal_reached", onGoalReached);
    bot.on("path_update", onPathUpdate);
    bot.on("goal_updated", onGoalUpdated);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. PERCEPTION (Scanner les alentours)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cherche le bloc le plus proche correspondant aux noms demandés.
 * @returns {mineflayer.Block | null} Le bloc trouvé, ou null.
 */
export function scanForBlock(
  bot: mineflayer.Bot,
  blockNames: string[],
  emit: (msg: string) => void,
  blacklist: Set<string> = new Set()
): mineflayer.Block | false {

  const matchingIds: number[] = [];

  for (const name of blockNames) {
    const b = bot.registry.blocksByName[name];
    if (b) matchingIds.push(b.id);
  }

  if (matchingIds.length === 0) return false;

  const positions = bot.findBlocks({
    matching: matchingIds,
    maxDistance: 32,
    count: 128
  });

  const validPositions = positions.filter(
    pos => !blacklist.has(`${pos.x},${pos.y},${pos.z}`)
  );

  if (validPositions.length === 0) return false;

  validPositions.sort(
    (a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b)
  );

  const bestPos = validPositions[0];
  const block = bot.blockAt(bestPos);

  if (!block) return false;
  return block;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ACTION PHYSIQUE (Minage, Pose, Collecte)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Va vers UN bloc spécifique, s'équipe de l'outil approprié, le casse, et attend la confirmation du serveur.
 * @returns {Promise<boolean>} true si le minage a été effectué et validé.
 */
export async function mineBlock(bot: mineflayer.Bot, targetBlock: mineflayer.Block, preferredTools: string[] = [], emit: (msg: string) => void): Promise<boolean> {
  try {
    const blockPos = targetBlock.position.clone();
    
    // 1. Se rendre au bloc
    const reached = await goTo(bot, blockPos.x, blockPos.y, blockPos.z, emit);
    // Sécurité : si on tape cancel pendant qu'il marche, on annule la suite
    if (!reached || (bot as any).isInterrupted) return false; 

    // --- FIX PHYSIQUE ---
    bot.clearControlStates();
    await bot.waitForTicks(4); 

    // 2. Équiper le meilleur outil
    let equipped = false;
    if (preferredTools && preferredTools.length > 0) {
      for (let i = preferredTools.length - 1; i >= 0; i--) {
        const toolName = preferredTools[i];
        const item = bot.inventory.items().find(i => i.name === toolName);
        
        if (item) {
          if (bot.heldItem && bot.heldItem.name === toolName) {
            emit(`[MINE] 🗡️ Déjà équipé de : ${toolName}`);
            equipped = true;
            break;
          }
          await bot.equip(item, 'hand');
          emit(`[MINE] 🗡️ Équipement de : ${toolName}`);
          equipped = true;
          break;
        }
      }
    }
    
    if (!equipped && preferredTools && preferredTools.length > 0) {
      try { await bot.unequip('hand'); } catch (e) { /* Ignoré */ }
    }

    await bot.waitForTicks(5);

    // 3. Miner le bloc
    emit(`[MINE] ⛏️ Cassage de ${targetBlock.name}...`);
    
    // --- NOUVEAU : SYSTÈME D'ÉCOUTE ANTI-DESYNC (Eau / Lag serveur) ---
    const waitForBreak = new Promise((resolve) => {
      const listener = (oldBlock: mineflayer.Block, newBlock: mineflayer.Block) => {
        // Si le bloc à ces coordonnées exactes a changé de type (ex: stone -> air ou eau)
        if (oldBlock.position.equals(blockPos) && newBlock.type !== targetBlock.type) {
          bot.removeListener('blockUpdate', listener);
          resolve(true); // Le serveur a confirmé la destruction !
        }
      };
      bot.on('blockUpdate', listener);
      
      // Si le serveur met plus de 15 secondes à valider (bug profond), on annule pour ne pas freeze l'IA
      setTimeout(() => {
        bot.removeListener('blockUpdate', listener);
        resolve(false); 
      }, 15000);
    });

    // L'IA lance son action physique
    await bot.dig(targetBlock);
    
    // On met le code en pause jusqu'à ce que le monde physique change vraiment
    const blockBroken = await waitForBreak;
    
    if (!blockBroken) {
       emit(`[MINE] ⚠️ Le serveur n'a pas validé la casse (Bloc sous l'eau ?). On ignore pour le moment.`);
       return false;
    }

    // On attend 5 ticks pour laisser le temps à l'item de spawner physiquement
    await bot.waitForTicks(5);

    // 4. Ramasser la ressource
    await collectDrop(bot, blockPos, emit);
    return true;
    
  } catch (e: any) {
    emit(`[MINE] ❌ Échec de l'extraction (${e.message}).`);
    bot.clearControlStates();
    return false;
  }
}

/**
 * Fonction pour chercher activement et ramasser un item tombé près d'une position.
 */
export async function collectDrop(bot: mineflayer.Bot, dropPosition: Vec3, emit: (msg: string) => void): Promise<void> {
  // On attend un peu plus longtemps pour laisser le temps au drop de se faire et à la physique de s'appliquer
  await new Promise(r => setTimeout(r, 500)); 

  // On élargit un peu le rayon de recherche (5 blocs au lieu de 4)
  const droppedItem = bot.nearestEntity((entity) => {
    return entity.type === 'item' && entity.position.distanceTo(dropPosition) < 5;
  });

  if (droppedItem) {
    emit(`[MINE] 🏃 Détection d'un item au sol, tentative de ramassage...`);
    const move = new Movements(bot);
    bot.pathfinder.setMovements(move);
    try {
      // On va exactement sur la position de l'entité item
      await bot.pathfinder.goto(new goals.GoalBlock(droppedItem.position.x, droppedItem.position.y, droppedItem.position.z));
      // Pause pour laisser le serveur valider le ramassage dans l'inventaire
      await new Promise(r => setTimeout(r, 800)); 
    } catch (e) {
      emit(`[MINE] ⚠️ Je n'ai pas pu atteindre l'item au sol.`);
    }
  } else {
     emit(`[MINE] ⚠️ Aucun item détecté autour de la zone de minage.`);
  }
}

/**
 * Trouve le premier espace libre et y pose un bloc depuis l'inventaire.
 * @returns {Promise<boolean>} true si posé.
 */
export async function placeBlock(bot: mineflayer.Bot, itemName: string, emit: (msg: string) => void): Promise<boolean> {
  const item = bot.inventory.items().find(i => i.name === itemName);
  if (!item) {
    emit(`[ACTION] ❌ Impossible de poser : Aucun ${itemName} dans l'inventaire.`);
    return false;
  }

  try {
    await bot.equip(item, 'hand');
    const nearbyBlocksPositions = bot.findBlocks({ 
      matching: (b) => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && !b.name.includes('leaves'), 
      maxDistance: 4,
      count: 20 
    });

    for (const pos of nearbyBlocksPositions) {
      const refBlock = bot.blockAt(pos);
      const blockAbove = bot.blockAt(pos.offset(0, 1, 0));

      if (refBlock && blockAbove && blockAbove.name === 'air') {
        const dist = bot.entity.position.distanceTo(pos);
        if (dist > 1.5 && dist < 4) { // Ni trop près (le bot bloque), ni trop loin
          const face = new Vec3(0, 1, 0);
          try {
            await bot.lookAt(pos.offset(0.5, 1, 0.5));
            await bot.placeBlock(refBlock, face);
            emit(`[ACTION] 🧱 ${itemName} posé avec succès.`);
            return true;
          } catch (err) {
            continue; // Si échec, on essaie le prochain bloc de la boucle
          }
        }
      }
    }
    emit(`[ACTION] ⚠️ Aucun espace dégagé trouvé pour poser le bloc.`);
    return false; 
  } catch (e: any) {
    emit(`[ACTION] ❌ Erreur critique lors de la pose : ${e.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FABRICATION (Exécution pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exécute l'action brute de craft. L'IA a déjà vérifié l'inventaire avant.
 * @returns {Promise<boolean>} true si réussi.
 */
export async function craftItem(bot: mineflayer.Bot, recipe: any, count: number, craftingTable: mineflayer.Block | null, emit: (msg: string) => void): Promise<boolean> {
  try {
    await bot.craft(recipe, count, craftingTable);
    return true;
  } catch (err: any) {
    emit(`[CRAFT] ❌ Erreur matérielle lors de la fabrication : ${err.message}`);
    return false;
  }
}

/**
 * Ouvre un four, place le carburant, le minerais, et attend la fin de la cuisson.
 */
/**
 * Ouvre un four, place le carburant, le minerais, et attend la fin de la cuisson.
 */
export async function smeltItem(bot: mineflayer.Bot, furnaceBlock: mineflayer.Block, inputName: string, count: number, emit: (msg: string) => void): Promise<boolean> {
  try {
    const reached = await goTo(bot, furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, emit);
    if (!reached || (bot as any).isInterrupted) return false;

    emit(`[FURNACE] ♨️ Ouverture du four...`);
    const furnace = await bot.openFurnace(furnaceBlock);
    
    // 1. NETTOYAGE : On récupère toujours ce qui a fini de cuire avant (débloque le four)
    if (furnace.outputItem()) {
        emit(`[FURNACE] 🧹 Récupération des objets cuits restants...`);
        try { await furnace.takeOutput(); } catch(e) {}
    }

    const itemToSmelt = bot.inventory.items().find(i => i.name === inputName);
    let fuel = bot.inventory.items().find(i => i.name === "coal" || i.name === "charcoal" || i.name.includes("planks") || i.name.includes("log"));

    if (!itemToSmelt || !fuel) {
        emit(`[FURNACE] ❌ Il me manque l'item à cuire ou le carburant.`);
        furnace.close();
        return false;
    }

    // 2. INTELLIGENCE CARBURANT : Si le four contient déjà un carburant, on s'adapte !
    const existingFuel = furnace.fuelItem();
    if (existingFuel) {
        const matchingFuelInInv = bot.inventory.items().find(i => i.name === existingFuel.name);
        if (matchingFuelInInv) fuel = matchingFuelInInv; // On utilise le même pour éviter de bloquer
    }

    // Calcul basique du carburant
    const fuelNeeded = fuel.name.includes("coal") ? Math.ceil(count / 8) : count;
    const fuelCountToUse = Math.min(fuel.count, fuelNeeded);

    emit(`[FURNACE] 🧱 Placement : ${count}x ${inputName} avec ${fuelCountToUse}x ${fuel.name}...`);
    
    // 3. ESSAI DE PLACEMENT + OPTION NUCLÉAIRE
    try {
        await furnace.putFuel(fuel.type, null, fuelCountToUse);
        await furnace.putInput(itemToSmelt.type, null, count);
    } catch (e: any) {
        // Si ça bloque (Destination Full), c'est que des vieux items incompatibles encombrent le four.
        emit(`[FURNACE] ⚠️ Le four est encombré par de vieux items ! Je le casse pour le réinitialiser.`);
        furnace.close();
        bot.clearControlStates();
        
        // On prend une pioche pour le casser vite
        const pickaxe = bot.inventory.items().find(i => i.name.includes("pickaxe"));
        if (pickaxe) await bot.equip(pickaxe, 'hand');
        
        await bot.dig(furnaceBlock);
        await bot.waitForTicks(20); // On laisse le temps au bot de ramasser le four et les items tombés
        
        // On retourne false. Le Cerveau (ai.ts) va voir l'échec et relancer la tâche.
        // Comme il n'y a plus de four posé, il posera celui qu'il vient de ramasser !
        return false; 
    }

    emit(`[FURNACE] ⏳ Cuisson en cours... (Cela va prendre un moment)`);
    
    let collected = 0;
    let attempts = 0;
    
    while (collected < count && attempts < 60) { // Max 2 minutes d'attente
        if ((bot as any).isInterrupted) { furnace.close(); return false; } // Sécurité d'annulation

        await new Promise(r => setTimeout(r, 2000));
        const outItem = furnace.outputItem();
        if (outItem && outItem.count > 0) {
            await furnace.takeOutput();
            collected += outItem.count;
            emit(`[FURNACE] 🟢 Récupéré : ${collected}/${count}`);
        }
        attempts++;
    }

    furnace.close();
    if (collected >= count) {
        emit(`[FURNACE] ✅ Cuisson terminée avec succès !`);
        return true;
    } else {
        emit(`[FURNACE] ⚠️ Cuisson incomplète ou interrompue.`);
        return false;
    }
  } catch (e: any) {
    emit(`[FURNACE] ❌ Erreur matérielle avec le four : ${e.message}`);
    return false;
  }
}