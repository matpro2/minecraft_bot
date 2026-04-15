import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";

const { Movements, goals } = pathfinderPkg;

// Listes de priorité (du meilleur au moins bon)
const SWORDS = ["netherite_sword", "diamond_sword", "iron_sword", "golden_sword", "stone_sword", "wooden_sword", "netherite_axe", "diamond_axe", "iron_axe", "stone_axe"];
const ARMOR_TYPES = {
  head: ["netherite_helmet", "diamond_helmet", "iron_helmet", "golden_helmet", "leather_helmet"],
  torso: ["netherite_chestplate", "diamond_chestplate", "iron_chestplate", "golden_chestplate", "leather_chestplate"],
  legs: ["netherite_leggings", "diamond_leggings", "iron_leggings", "golden_leggings", "leather_leggings"],
  feet: ["netherite_boots", "diamond_boots", "iron_boots", "golden_boots", "leather_boots"]
};

export let isFighting = false;

export async function executeCombat(bot: mineflayer.Bot, target: any, emit: (msg: string) => void) {
  if (isFighting) return;
  isFighting = true;

  emit(`[COMBAT] 🚨 Riposte contre ${target.name} ! Phase de préparation...`);

  // 1. ARRÊT D'URGENCE
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();

  // 2. ÉQUIPEMENT DE L'ARMURE (Cherche la meilleure pièce disponible pour chaque slot)
  for (const [slot, items] of Object.entries(ARMOR_TYPES)) {
    for (const itemName of items) {
      const piece = bot.inventory.items().find(i => i.name === itemName);
      if (piece) {
        try {
          await bot.equip(piece, slot as any);
        } catch (e) {}
        break; // On a équipé la meilleure, on passe au slot suivant
      }
    }
  }

  // 3. ÉQUIPEMENT DE L'ARME
  let weaponFound = false;
  for (const weaponName of SWORDS) {
    const weapon = bot.inventory.items().find(i => i.name === weaponName);
    if (weapon) {
      try {
        await bot.equip(weapon, 'hand');
        emit(`[COMBAT] 🗡️ Arme équipée : ${weaponName}.`);
        weaponFound = true;
      } catch (e) {}
      break;
    }
  }
  if (!weaponFound) emit(`[COMBAT] ⚠️ Aucune arme trouvée, combat à mains nues !`);

  // 4. BOUCLE D'ATTAQUE
  const move = new Movements(bot);
  move.canDig = false; 
  move.allow1by1towers = false;
  bot.pathfinder.setMovements(move);

  while (target && target.isValid && target.position.distanceTo(bot.entity.position) < 16) {
    // On le suit à 2 blocs de distance
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
    
    if (target.position.distanceTo(bot.entity.position) < 3) {
      // Regarder le centre du mob
      await bot.lookAt(target.position.offset(0, target.height / 2, 0));
      bot.attack(target);
      await bot.waitForTicks(10); // Délai de frappe
    } else {
      await bot.waitForTicks(2);
    }
  }

  emit(`[COMBAT] 🏆 Menace écartée.`);
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  
  await bot.waitForTicks(20);
  isFighting = false;
}