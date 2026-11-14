import * as THREE from 'three';

/* =====================================================================
   MOON MISSION — Level 1: Ancient Fire Moon
   Third-person: walk out of the lab, drive the rover across a huge
   cratered map, collect rock samples, bring them back to the lab.
   ===================================================================== */

// ----------------------------------------------------------------- constants
const GOAL = 12;            // samples to deliver
const CAP_FOOT = 4;         // backpack capacity
const START_MONEY = 100;   // $ at the start of the mission
const REWARD = 150;        // $ paid for every sample stored in the lab
const HEAL_COST = 3;       // $ per health point restored at the lab
const REPAIR_COST = 1.2;   // $ per % of rover health repaired at the lab
const JUMP_G = 5.0;        // stylised low gravity (m/s^2)
const JUMP_FOOT = 4.7;     // astronaut take-off speed
const JUMP_CAR = 5.0;      // rover take-off speed
const JUMP_G_CAR = 9.0;    // the heavy rover falls faster than the astronaut
const CAP_CARGO = 12;       // rover capacity
const TANK_START = 35;     // base oxygen tank at the start of level 1 (%)
const ROCK_O2 = 9;         // % of the base tank one rock gives in the oxygen maker
const REFILL_COST = 0.1;   // base-tank % used for every 1% of suit oxygen refilled
const MAKER_RATE = 4;      // %/s the oxygen maker adds to the tank while heating rocks
const CS = 192;             // terrain chunk size (m)
const RING = 7;             // chunks loaded around the player (view ~1.3 km)
const NEAR = 2;             // high-detail ring
const WORLD = 5000;         // half-size of the playable map (10 km x 10 km)
const DOOR = { x: 0, z: 19 };
const LAB_RADIUS = 30;
// stations inside the base
const MED = { x: -6.6, z: 1.5 };      // medical bay (H)
const STORE = { x: 7.0, z: 1.5 };     // sample storage (E)
const WORKSHOP = { x: 0, z: -7.4 };   // rover workshop (R)
const DOME_IN = 9.4, DOME_OUT = 10.9; // dome wall (ring) — open at the doorway on +z
const DOOR_HALF = 1.5;                // half width of the doorway
function inBuilding(x, z) { return Math.hypot(x, z) < DOME_IN || (Math.abs(x) < 2.9 && z > 9.0 && z < 16.9); }
// solid parts of the base (ground plan): circles [x, z, r] and boxes [x0, z0, x1, z1]
const LAB_CIRCLES = [[0, 0, 1.5], [20, 18, 2.3], [-14, 22, 0.6], [8, 22, 0.4], [7.6, -1.5, 0.65]];
for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; LAB_CIRCLES.push([Math.sin(a) * 27, Math.cos(a) * 27, 0.35]); }   // lamp posts
const LAB_BOXES = [
  [10.5, -3.4, 25.8, 3.4], [-25.8, -3.4, -10.5, 3.4], [-3.4, -25.8, 3.4, -10.5],   // side modules + tubes
  [2.9, 9.3, 3.3, 16.9], [-3.3, 9.3, -2.9, 16.9],                                   // airlock side walls
  [DOOR_HALF, 16.5, 3.3, 16.9], [-3.3, 16.5, -DOOR_HALF, 16.9],                     // airlock front wall (doorway between)
  [31, -13, 45, 13],                                                                // solar farm
  [-9.4, 18.2, -6.8, 21.8],                                                         // cargo crates
  [-7.4, -0.1, -5.8, 3.1], [6.5, -0.3, 7.5, 3.3], [-1.7, -8.4, 1.7, -7.4]           // medical bay, storage, workshop
];
// deepest contact of a circle (px, pz, rad) with the base, or null
function labContact(px, pz, rad) {
  if (px * px + pz * pz > 60 * 60) return null;
  let best = null;
  // dome wall: a ring that is open at the doorway (+z) for anything that fits through
  const rr = Math.hypot(px, pz);
  if (rr > DOME_IN - rad && rr < DOME_OUT + rad && !(pz > 0 && Math.abs(px) <= DOOR_HALF - rad)) {
    const mid = (DOME_IN + DOME_OUT) / 2;
    const c = rr <= mid ? { nx: -px / (rr || 1), nz: -pz / (rr || 1), pen: rr + rad - DOME_IN } : { nx: px / rr, nz: pz / rr, pen: DOME_OUT + rad - rr };
    if (c.pen > 0) best = c;
  }
  if (SHELTER.on) {                          // storm shelter: hollow ring with a doorway at +z, plus the two valves
    if (rr > SHELTER.rIn - rad && rr < SHELTER.rOut + rad && !(pz > 0 && Math.abs(px) <= SHELTER.door - rad)) {
      const mid = (SHELTER.rIn + SHELTER.rOut) / 2;
      const c = rr <= mid ? { nx: -px / (rr || 1), nz: -pz / (rr || 1), pen: rr + rad - SHELTER.rIn } : { nx: px / rr, nz: pz / rr, pen: SHELTER.rOut + rad - rr };
      if (c.pen > 0 && (!best || c.pen > best.pen)) best = c;
    }
    for (const v of VALVES) {
      const dx = px - v.x, dz = pz - v.z, d = Math.hypot(dx, dz), pen = 0.3 + rad - d;
      if (pen > 0 && (!best || pen > best.pen)) best = d > 1e-4 ? { nx: dx / d, nz: dz / d, pen } : { nx: 1, nz: 0, pen };
    }
  }
  for (const [cx, cz, r] of LAB_CIRCLES) {
    if (SHELTER.on && cx === 0 && cz === 0) continue;   // the hologram table is replaced by the shelter
    const dx = px - cx, dz = pz - cz, d = Math.hypot(dx, dz), pen = r + rad - d;
    if (pen > 0 && (!best || pen > best.pen)) best = d > 1e-4 ? { nx: dx / d, nz: dz / d, pen } : { nx: 1, nz: 0, pen };
  }
  for (const [x0, z0, x1, z1] of LAB_BOXES) {
    const qx = Math.max(x0, Math.min(x1, px)), qz = Math.max(z0, Math.min(z1, pz)), dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
    let c = null;
    if (d > 1e-4) { if (d < rad) c = { nx: dx / d, nz: dz / d, pen: rad - d }; }
    else {                                    // centre is inside the box: leave through the nearest face
      const e = [[px - x0, -1, 0], [x1 - px, 1, 0], [pz - z0, 0, -1], [z1 - pz, 0, 1]].sort((a, b) => a[0] - b[0])[0];
      c = { nx: e[1], nz: e[2], pen: e[0] + rad };
    }
    if (c && (!best || c.pen > best.pen)) best = c;
  }
  return best;
}
const SUN = new THREE.Vector3(0.82, 0.34, 0.5).normalize();
// ---- day / night
const DAY_LEN = 480;           // seconds of play for one full lunar day
const CLOCK_START = 0.30;      // game starts in the morning
const SUN_MAX = 62 * Math.PI / 180;
const T_NIGHT = -173, T_DAY = 121;   // surface temperature extremes (°C)
// ---- mission "Solar Radiation Storm"
const SHELTER = { on: false, rIn: 2.05, rOut: 2.75, door: 1.0 };
const VALVES = [{ x: 3.7, z: -0.6 }, { x: -3.7, z: -0.6 }];
const STORM_WARN = 45, VALVE_TIME = 5, STORM_SAFE = 6;
// ---- real Moon map (NASA LRO mosaic, equirectangular, centred on 0° longitude)
const MAP_SITES = [
  { key: 'site1', lat: 20.19, lon: 30.77, level: 1 },        // Taurus–Littrow, Apollo 17
  { key: 'site2', lat: -89.67, lon: 129.78, level: 2, lb: 'up' },      // Shackleton crater
  { apollo: 11, y: 1969, lat: 0.67, lon: 23.47 }, { apollo: 12, y: 1969, lat: -3.01, lon: -23.42, lb: 'left' },
  { apollo: 14, y: 1971, lat: -3.65, lon: -17.47 }, { apollo: 15, y: 1971, lat: 26.13, lon: 3.63 },
  { key: 'site3', lat: -8.97, lon: 15.5, level: 3 }           // Descartes Highlands, Apollo 16
];
// ---- mission "The Deadly Shadow"
const SHADOW = { on: false, x: -250, z: 215, R: 88, D: 42 };
const SH_E = 11 * Math.PI / 180;               // low sun: the crater floor stays in shadow
const SH_U = (() => { const x = 0.82, z = -0.57, l = Math.hypot(x, z); return { x: x / l, z: z / l }; })();
const MIR_SPOTS = [-0.4, 0, 0.4].map(th => {
  const c = Math.cos(th), sn = Math.sin(th), ux = SH_U.x * c - SH_U.z * sn, uz = SH_U.x * sn + SH_U.z * c;
  return { x: SHADOW.x + ux * SHADOW.R, z: SHADOW.z + uz * SHADOW.R, placed: false };
});
const TOWER = { x: SHADOW.x, z: SHADOW.z };
const TOWER_WORK = 24;         // seconds of repair work needed
const MIRROR_HEAT = 65;        // °C every mirror adds inside the lit pool
const POOL_R = 17;

// ----------------------------------------------------------------- strings
const T = {
  en: {
    health: 'Health', oxygen: 'Oxygen', energy: 'Energy', radiation: 'Radiation', rover: 'Rover',
    delivered: 'Samples delivered', carrying: 'Backpack', cargo: 'Rover cargo', kmh: 'km/h',
    st_ok: 'Safe', st_fatigue: 'Fatigue', st_illness: 'Radiation sickness', st_injury: 'Radiation injury',
    obj_getRover: 'Walk to the rover and get in', obj_drive: 'Drive to the glowing crater',
    obj_collect: 'Collect the glowing rock samples', obj_load: 'Load the samples into the rover',
    obj_return: 'Drive back to the lab', obj_store: 'Put the rocks into the oxygen maker',
    obj_walkRover: 'Return to the rover', obj_exitLab: 'Walk out of the lab',
    tgt_lab: 'Lab', tgt_rover: 'Rover', tgt_rock: 'Sample',
    p_enter: 'Press E — get into the rover', p_exit: 'Press E — get out of the rover',
    p_collect: 'Press E — collect rock sample', p_load: 'Press E — load samples into the rover',
    p_store: 'Press E — put the rocks into the oxygen maker',
    a_collect: 'Collecting sample…', a_load: 'Loading the rover…', a_store: 'Loading the oxygen maker…',
    w_flareSoon: 'Solar flare in {s} s — get to shelter!',
    w_flare: 'SOLAR FLARE — radiation x3.5! Reach the lab or hide in a crater.',
    w_o2: 'Low oxygen! Return to the lab.', w_en: 'Energy empty — the rover crawls slowly!',
    w_edge: 'You are leaving the mapped area. Turn back.', w_rad: 'High radiation! Get to the lab.',
    m_refill: 'Lab: refilling your suit from the base oxygen tank',
    m_repair: 'Lab: the rover is being repaired',
    money: 'Money', f_broke: 'Not enough money!', f_earn: '+${m} — samples delivered',
    s_heal: 'Press <kbd>H</kbd> — heal to full ({c})', s_healing: 'Healing… press <kbd>H</kbd> to stop',
    s_repair: 'Press <kbd>R</kbd> — repair the rover ({c})', s_repairing: 'Repairing the rover… press <kbd>R</kbd> to stop',
    w_hit: 'Collision! Rover −{d}%', w_rv1: 'Rover badly damaged — avoid the stones, repair it at the lab.', w_rv0: 'Rover wrecked — it can only crawl. Repair it at the lab.',
    v_first: 'FIRST-PERSON VIEW', v_third: 'THIRD-PERSON VIEW',
    helpTitle: 'MOON MISSION',
    help: ['W / S — walk or drive forward / back', 'A / D — turn left / right',
      'Space — jump · Shift — run · B — brake', 'E — interact (rover, rocks, lab)',
      'C — switch 3rd / 1st person view', 'Inside the base: E — oxygen maker · H — medical bay · R — workshop (costs money)', 'Drag the mouse — look around · Wheel — zoom', 'M — Moon map (where you are on the real Moon)', 'Esc — pause'],
    helpGoal: 'Drive to the glowing craters, collect rock samples, load them into the rover and store 12 samples in the lab. The sun’s radiation hurts you outside, and oxygen and energy run down — return to the lab to recover. Stones damage the rover. Go through the airlock into the base: store samples at the storage rack (E), earn money, and spend it at the medical bay (H) and the workshop (R).',
    begin: 'BEGIN MISSION', loading: 'Generating the Moon…',
    paused: 'PAUSED', resume: 'RESUME', quit: 'BACK TO LEVELS',
    winT: 'Discovery complete!', winD: '{d} You delivered {n} samples in {t}.',
    loseT: 'Mission failed', lose_rad: 'Radiation sickness took the astronaut.', lose_o2: 'The astronaut ran out of oxygen. Next time, turn back before the Oxygen bar reaches the white line.',
    again: 'PLAY AGAIN', site: 'Crater', lab: 'LAB',
    kidTitle: 'Mission briefing for young astronauts', kidTitleM: 'Mission briefing: The Deadly Shadow', readAloud: '🔊 Read aloud', stopRead: '⏹ Stop reading', controls: 'Controls',
    kidMoon: ['Welcome, young astronaut! Our Moon base is running out of air to breathe.', 'There is no air on the Moon. Your space suit carries a small tank of oxygen, and the base has one big oxygen tank.', 'Here is the secret: Moon rocks are almost half oxygen! It is locked inside the stone, and the oxygen maker in the base can pull it out.', 'Your job: collect the glowing rocks, bring them back, and put them into the oxygen maker. Fill the base tank to 100 percent.', 'Watch the Oxygen bar. The timer shows how long your air will last, and the white line shows how much air you need to get home. Always turn back before your oxygen reaches the line!', 'Running makes you breathe faster and uses more oxygen. The rover is fast, so driving uses less air on every trip.', 'At the base, the lab refills your suit from the big tank. Every refill uses base oxygen, so do not waste it.', 'Walk with W, A, S and D, jump with Space, and press E to pick up rocks and to get into the rover.', 'Ready? Press the Begin button. Good luck!'],
    kidShadow: ['Welcome, young astronaut! A radio tower is broken inside a deep, dark crater.', 'In the sunshine, your space suit gets very hot. But in the crater\'s shadow it is minus 173 degrees! Your energy and health freeze fast.', 'Here is a secret. On Earth, the air works like a blanket and keeps the heat. The Moon has no air, so the sun is boiling and the shade is freezing.', 'Your plan: drive the rover to the crater. Walk to each glowing spot on the sunny edge and press E to put up a giant mirror. You have three mirrors.', 'The mirrors bounce sunlight into the dark crater and make a warm, bright spot around the tower.', 'Now climb down, stand in the warm light, and press E at the tower to start repairing it. If you walk away, the repair pauses, so you can warm up and come back.', 'Walk with W, A, S and D, jump with Space, and press E to use things. Press C to change the camera.', 'Ready? Press the Begin button. Good luck!'],
    tank: 'Base oxygen tank', o2home: 'Way home needs ~{n}%', obj_fill: 'Base oxygen tank: {n}%', maker: 'Oxygen maker', heating: '{n} rocks heating', idle: 'ready', rocks: 'Rocks delivered', obj_home: 'Go back and refill your oxygen', w_turn: 'TURN BACK NOW! You have {a}% oxygen — the way home needs about {b}%.', w_soon: 'Head home soon — your oxygen is close to the white line.', w_tank0: 'The base tank is EMPTY — the lab cannot refill your suit! The backup makes air very slowly. Bring rocks!', w_tankLow: 'The base tank is almost empty — bring rocks soon!', f_oxy: '+{o}% base oxygen · +${m}', f_newRocks: 'New glowing rocks were found at the craters!', tip_out: 'You are outside now. Your suit uses oxygen — watch the timer next to Oxygen.', tip_run: 'Running makes you breathe faster: oxygen goes down almost twice as fast.', tip_rover: 'The rover is fast, so every trip uses less oxygen. Drive to save air!', tip_half: 'Half your oxygen is gone. Keep the Oxygen bar above the white line — that is what you need to get home.', tip_rock: 'This dark lava rock is almost half oxygen, locked inside its minerals!', tip_maker: 'The oxygen maker heats the rocks and pulls the oxygen out. Watch the base tank fill up!', tip_refill: 'The lab is refilling your suit from the base tank. Every refill uses base oxygen.', winT1: 'The base can breathe again!', winD1: 'You made enough oxygen from Moon rocks to fill the base tank ({n} rocks, time {t}). Moon rocks are about 40–45% oxygen by weight — it is locked inside minerals that formed in ancient lava. Future astronauts plan to make air to breathe and rocket fuel this way.',
    map_title: 'MOON MAP', map_sub: 'Real photo map of the whole Moon, taken by a NASA spacecraft that flies around the Moon', map_btn: 'MAP', map_close: 'CLOSE', map_credit: 'Map: NASA Goddard Space Flight Center / Arizona State University · Press M or Esc to close', map_here: 'YOU ARE HERE', map_lvl: 'Level {n}', map_near: 'Near side (faces Earth)', map_far: 'Far side', map_hint: 'Tap a marker to learn about the place.', site1_name: 'Taurus–Littrow valley (Apollo 17)', site1_info: 'Ancient lava flooded this valley. In 1972 the Apollo 17 astronauts found orange glass beads here, made by volcanic “fire fountains”. The dark lava rock here is full of a mineral that oxygen can be pulled out of. That is why our oxygen base is here.', site2_name: 'Shackleton crater, south pole', site2_info: 'About 21 km wide and more than 4 km deep. At the pole the Sun always stays very low, so the crater floor has been in shadow for billions of years and is one of the coldest places we know — far below −173 °C.', apollo_info: 'Apollo {n} landed here in {y}.', help_map: 'M — Moon map (where you are on the real Moon)',
    kidTitleS: 'Mission briefing: Solar Radiation Storm', kidStorm: ['Welcome, young astronaut! You are outside, near the Moon base.', 'Soon the Sun will blast out a solar storm. A red warning will appear with a 45-second timer.', 'Spacesuits and thin walls cannot stop a solar storm! If it catches you outside, the screen fills with static, the radiation counter clicks loudly, and your health drops fast.', 'Run into the base! Hold Shift to run. In the middle of the base is the round Storm Shelter.', 'The shelter has hollow walls. Go to the two water valves and hold E for 5 seconds on each one to pump water into the walls.', 'Here is the science: water stops radiation better than metal! Water is full of hydrogen, which soaks up the storm\'s tiny particles.', 'When both walls are full, step inside the shelter. You are safe, and your health comes back.', 'Ready? Press the Begin button. Good luck!'], st_warnT: 'SOLAR STORM INCOMING', st_hitT: 'SOLAR STORM! RADIATION HIGH', st_msg: 'Spacesuits and thin walls cannot stop a Solar Storm! Get to the Storm Shelter!', st_hitSay: 'The solar storm is here! Get into the shelter and fill its walls with water!', st_safe: 'The water walls are blocking the radiation. Stay inside!', obj_survey: 'Look around near the base', sobj_run: 'Run into the base — to the Storm Shelter!', sobj_valve: 'Hold E on water valve {n} to fill the shelter wall', sobj_enter: 'Step inside the Storm Shelter', sobj_wait: 'You are safe. Stay inside — the storm is coming', sobj_ok: 'Shielded! Stay inside — your health is coming back', walls: 'Shelter walls', tgt_shelter: 'Shelter', tgt_valve: 'Valve {n}', p_valve: 'Hold E — pump water into wall {n} ({p}%)', a_valve: 'Pumping water into wall {n}…', st_wallFull: 'Wall {n} is full of water!', storm_in: 'Storm in', lose_storm: 'The solar storm’s radiation was too strong. Next time, run to the shelter and fill its walls with water right away.', swinT: 'You survived the solar storm!', swinD: 'The water walls blocked the radiation and kept you safe (time {t}). Water is full of hydrogen, which stops a storm’s tiny particles better than metal — metal can even make extra radiation when the particles hit it. That is why scientists want to use water and Moon soil to shield future Moon bases.', site3_name: 'Descartes Highlands (Apollo 16)', site3_info: 'Apollo 16 astronauts explored here in April 1972. Only four months later, in August 1972, one of the strongest solar storms of the space age hit the Moon. Anyone standing here would have needed a storm shelter.',
    clock: 'Lunar time', t_out: 'Outside', t_suit: 'Suit', ph_day: 'Day', ph_night: 'Night', ph_dawn: 'Sunrise', ph_dusk: 'Sunset',
    w_cold: 'SUIT FREEZING — get into sunlight or the mirror beam!', w_hot: 'SUIT OVERHEATING — get into shade or the rover!',
    w_dark: 'Crater shadow: no air to hold heat — it is −173 °C! Place mirrors on the rim.',
    lose_cold: 'The astronaut froze in the crater’s shadow.', lose_heat: 'The astronaut overheated in the sunlight.',
    mirrors: 'Mirrors', tower: 'Tower repair', in_pack: 'in backpack', placed: 'placed',
    mobj_drive: 'Drive to the dark crater with the broken tower', mobj_mirror: 'Place the mirrors on the crater rim ({n} / 3)',
    mobj_tower: 'Climb down and repair the tower', tgt_spot: 'Mirror spot', tgt_tower: 'Tower',
    p_mirror: 'Press E — set up a giant mirror', p_repair: 'Press E — repair the tower (move to pause)',
    a_mirror: 'Setting up the mirror…', a_repair: 'Repairing the tower…',
    f_mirror: 'Mirror {n} / 3 is up — sunlight reaches the crater!', f_tower: 'Tower repaired — signal restored!',
    mhelpGoal: 'THE DEADLY SHADOW. A communication tower broke inside a deep, dark crater. In the sunlight your suit gets dangerously hot; in the crater’s shadow it is −173 °C and your energy and health freeze fast. Place the 3 giant mirrors on the sunny rim (E) so they bounce sunlight down onto the tower, then climb down and repair it while the light keeps you warm. Rest and heal at the base (costs money).',
    mwinT: 'Tower repaired!', mwinD: 'Mirrors turned the dark crater into a warm work spot and you restored the signal in {t}. The Moon has no air to trap heat: in the Sun it boils (+121 °C), in the shadow it freezes (−173 °C). Earth’s invisible atmosphere is a blanket that keeps our days and nights comfortable.'
  },
  uz: {
    health: 'Salomatlik', oxygen: 'Kislorod', energy: 'Energiya', radiation: 'Radiatsiya', rover: 'Rover',
    delivered: 'Yetkazilgan namunalar', carrying: 'Ryukzak', cargo: 'Rover yuki', kmh: 'km/soat',
    st_ok: 'Xavfsiz', st_fatigue: 'Charchoq', st_illness: 'Nur kasalligi', st_injury: 'Radiatsion jarohat',
    obj_getRover: 'Roverga borib, unga o‘tiring', obj_drive: 'Yonib turgan krater tomon yuring',
    obj_collect: 'Yonib turgan tosh namunalarini yig‘ing', obj_load: 'Namunalarni roverga yuklang',
    obj_return: 'Laboratoriyaga qayting', obj_store: 'Toshlarni kislorod mashinasiga soling',
    obj_walkRover: 'Roverga qayting', obj_exitLab: 'Laboratoriyadan chiqing',
    tgt_lab: 'Laboratoriya', tgt_rover: 'Rover', tgt_rock: 'Namuna',
    p_enter: 'E bosing — roverga o‘tirish', p_exit: 'E bosing — roverdan tushish',
    p_collect: 'E bosing — tosh namunasini olish', p_load: 'E bosing — namunalarni roverga yuklash',
    p_store: 'E bosing — toshlarni kislorod mashinasiga solish',
    a_collect: 'Namuna olinmoqda…', a_load: 'Rover yuklanmoqda…', a_store: 'Kislorod mashinasiga solinmoqda…',
    w_flareSoon: 'Quyosh alangasi {s} soniyada — panoh toping!',
    w_flare: 'QUYOSH ALANGASI — radiatsiya 3,5 baravar! Laboratoriyaga yoki kraterga yashiring.',
    w_o2: 'Kislorod kam! Laboratoriyaga qayting.', w_en: 'Energiya tugadi — rover sekin yuradi!',
    w_edge: 'Xarita chegarasidan chiqyapsiz. Orqaga qayting.', w_rad: 'Radiatsiya yuqori! Laboratoriyaga boring.',
    m_refill: 'Laboratoriya: kostyum baza kislorod bakidan to‘ldirilmoqda',
    m_repair: 'Laboratoriya: rover ta’mirlanmoqda',
    money: 'Pul', f_broke: 'Pul yetarli emas!', f_earn: '+${m} — namunalar topshirildi',
    s_heal: '<kbd>H</kbd> bosing — to‘liq davolanish ({c})', s_healing: 'Davolanmoqda… to‘xtatish uchun <kbd>H</kbd>',
    s_repair: '<kbd>R</kbd> bosing — roverni ta’mirlash ({c})', s_repairing: 'Rover ta’mirlanmoqda… to‘xtatish uchun <kbd>R</kbd>',
    w_hit: 'To‘qnashuv! Rover −{d}%', w_rv1: 'Rover qattiq shikastlandi — toshlardan qoching, laboratoriyada ta’mirlang.', w_rv0: 'Rover ishdan chiqdi — faqat sekin yura oladi. Laboratoriyada ta’mirlang.',
    v_first: 'BIRINCHI SHAXS KO‘RINISHI', v_third: 'UCHINCHI SHAXS KO‘RINISHI',
    helpTitle: 'OY MISSIYASI',
    help: ['W / S — oldinga / orqaga yurish yoki haydash', 'A / D — chapga / o‘ngga burilish',
      'Space — sakrash · Shift — yugurish · B — tormoz', 'E — o‘zaro ta’sir (rover, toshlar, laboratoriya)',
      'C — ko‘rinish: 3-shaxs / 1-shaxs', 'Bazada: E — kislorod mashinasi · H — tibbiyot · R — ustaxona (pul kerak)', 'Sichqonchani sudrang — atrofga qarash · G‘ildirak — yaqinlashtirish', 'M — Oy xaritasi (haqiqiy Oyda qayerdasiz)', 'Esc — pauza'],
    helpGoal: 'Yonib turgan kraterlarga boring, tosh namunalarini yig‘ing, roverga yuklang va laboratoriyaga 12 ta namuna yetkazing. Tashqarida quyosh radiatsiyasi zarar qiladi, kislorod va energiya kamayadi — tiklanish uchun laboratoriyaga qayting. Toshlar roverga zarar yetkazadi. Shlyuz orqali bazaga kiring: namunalarni omborga (E) qo‘ying, pul ishlang va uni tibbiyot xonasi (H) hamda ustaxona (R) uchun sarflang.',
    begin: 'MISSIYANI BOSHLASH', loading: 'Oy yaratilmoqda…',
    paused: 'PAUZA', resume: 'DAVOM ETISH', quit: 'BOSQICHLARGA QAYTISH',
    winT: 'Kashfiyot yakunlandi!', winD: '{d} Siz {t} ichida {n} ta namuna yetkazdingiz.',
    loseT: 'Missiya muvaffaqiyatsiz', lose_rad: 'Nur kasalligi kosmonavtni olib ketdi.', lose_o2: 'Kosmonavtning kislorodi tugadi. Keyingi safar Kislorod chizig‘i oq chiziqqa yetmasdan orqaga qayting.',
    again: 'QAYTA O‘YNASH', site: 'Krater', lab: 'LAB',
    kidTitle: 'Yosh kosmonavtlar uchun missiya tushuntirishi', kidTitleM: 'Missiya tushuntirishi: O‘limli soya', readAloud: '🔊 Ovoz chiqarib o‘qish', stopRead: '⏹ To‘xtatish', controls: 'Boshqaruv',
    kidMoon: ['Xush kelibsiz, yosh kosmonavt! Oydagi bazamizda nafas olish uchun havo tugab bormoqda.', 'Oyda havo yo‘q. Kostyumingizda kichik kislorod idishi bor, bazada esa bitta katta kislorod baki bor.', 'Mana sir: Oy toshlarining deyarli yarmi kislorod! U tosh ichiga qamalgan, bazadagi kislorod mashinasi esa uni ajratib oladi.', 'Vazifangiz: yonib turgan toshlarni yig‘ing, olib keling va kislorod mashinasiga soling. Baza bakini 100 foizgacha to‘ldiring.', 'Kislorod ko‘rsatkichini kuzating. Taymer havo qancha vaqtga yetishini, oq chiziq esa uyga qaytish uchun qancha havo kerakligini ko‘rsatadi. Kislorod chiziqqa yetmasdan har doim orqaga qayting!', 'Yugurganda tezroq nafas olasiz va ko‘proq kislorod sarflaysiz. Rover tez yuradi, shuning uchun har bir safarda kamroq havo ketadi.', 'Bazada laboratoriya kostyumingizni katta bakdan to‘ldiradi. Har bir to‘ldirish baza kislorodini sarflaydi, shuning uchun uni isrof qilmang.', 'W, A, S, D bilan yuring, Probel bilan sakrang, tosh olish va roverga o‘tirish uchun E ni bosing.', 'Tayyormisiz? Boshlash tugmasini bosing. Omad!'],
    kidShadow: ['Xush kelibsiz, yosh kosmonavt! Chuqur va qorong‘i krater ichida aloqa minorasi sindi.', 'Quyosh nurida kostyumingiz juda qiziydi. Krater soyasida esa minus 173 daraja! Energiya va salomatlik tez muzlaydi.', 'Mana bir sir. Yerda havo ko‘rpa kabi issiqlikni ushlab turadi. Oyda havo yo‘q, shuning uchun quyoshda qaynaydi, soyada muzlaydi.', 'Rejangiz: roverda kraterga boring. Quyoshli qirg‘oqdagi har bir yonib turgan joyga borib, E ni bosing va ulkan oyna o‘rnating. Sizda uchta oyna bor.', 'Oynalar quyosh nurini qorong‘i kraterga qaytaradi va minora atrofida iliq, yorug‘ joy hosil qiladi.', 'Endi pastga tushing, iliq nurda turing va minora yonida E ni bosib, ta’mirlashni boshlang. Uzoqlashsangiz, ta’mir to‘xtab turadi, isinib qaytishingiz mumkin.', 'W, A, S, D bilan yuring, Probel bilan sakrang, E bilan harakat qiling. C tugmasi kamerani almashtiradi.', 'Tayyormisiz? Boshlash tugmasini bosing. Omad!'],
    tank: 'Baza kislorod baki', o2home: 'Uyga qaytishga ~{n}% kerak', obj_fill: 'Baza kislorod baki: {n}%', maker: 'Kislorod mashinasi', heating: '{n} ta tosh qizimoqda', idle: 'tayyor', rocks: 'Topshirilgan toshlar', obj_home: 'Qaytib, kislorodni to‘ldiring', w_turn: 'HOZIROQ ORQAGA QAYTING! Sizda {a}% kislorod bor — uyga yo‘l taxminan {b}% oladi.', w_soon: 'Tez orada uyga qayting — kislorod oq chiziqqa yaqinlashmoqda.', w_tank0: 'Baza baki BO‘SH — laboratoriya kostyumni to‘ldira olmaydi! Zaxira tizim havoni juda sekin qiladi. Tosh olib keling!', w_tankLow: 'Baza baki deyarli bo‘sh — tezroq tosh olib keling!', f_oxy: '+{o}% baza kislorodi · +${m}', f_newRocks: 'Kraterlarda yangi yonib turgan toshlar topildi!', tip_out: 'Endi siz tashqaridasiz. Kostyum kislorod sarflaydi — Kislorod yonidagi taymerni kuzating.', tip_run: 'Yugurganda tez nafas olasiz: kislorod deyarli ikki baravar tez kamayadi.', tip_rover: 'Rover tez yuradi, shuning uchun har bir safarda kamroq kislorod ketadi. Havoni tejash uchun roverda yuring!', tip_half: 'Kislorodning yarmi tugadi. Kislorod chizig‘ini oq chiziqdan yuqorida saqlang — uyga qaytish uchun shuncha kerak.', tip_rock: 'Bu qora lava toshining deyarli yarmi kislorod — u minerallar ichiga qamalgan!', tip_maker: 'Kislorod mashinasi toshlarni qizdirib, ichidan kislorodni ajratib oladi. Baza baki to‘lishini kuzating!', tip_refill: 'Laboratoriya kostyumingizni baza bakidan to‘ldirmoqda. Har bir to‘ldirish baza kislorodini sarflaydi.', winT1: 'Baza yana nafas olmoqda!', winD1: 'Siz Oy toshlaridan baza bakini to‘ldirishga yetarli kislorod oldingiz ({n} ta tosh, vaqt {t}). Oy toshlari og‘irligining taxminan 40–45 foizi kislorod — u qadimgi lavada hosil bo‘lgan minerallar ichiga qamalgan. Kelajakda kosmonavtlar shu yo‘l bilan nafas olish uchun havo va raketa yoqilg‘isi olishni rejalashtirmoqda.',
    map_title: 'OY XARITASI', map_sub: 'Oy atrofida uchadigan NASA kosmik apparati olgan butun Oyning haqiqiy foto xaritasi', map_btn: 'XARITA', map_close: 'YOPISH', map_credit: 'Xarita: NASA Goddard kosmik parvozlar markazi / Arizona shtat universiteti · Yopish uchun M yoki Esc', map_here: 'SIZ SHU YERDASIZ', map_lvl: '{n}-bosqich', map_near: 'Yaqin tomon (Yerga qaragan)', map_far: 'Uzoq tomon', map_hint: 'Joy haqida bilish uchun belgini bosing.', site1_name: 'Taurus–Littrou vodiysi (Apollon 17)', site1_info: 'Bu vodiyni qadimgi lava to‘ldirgan. 1972-yilda Apollon 17 kosmonavtlari bu yerda vulqon “olov favvoralari” hosil qilgan to‘q sariq shisha donachalarni topdilar. Bu yerdagi qora lava toshida kislorod ajratib olish mumkin bo‘lgan mineral ko‘p. Shuning uchun kislorod bazamiz shu yerda.', site2_name: 'Shekklton krateri, janubiy qutb', site2_info: 'Kengligi taxminan 21 km, chuqurligi 4 km dan ortiq. Qutbda Quyosh doim juda past turadi, shuning uchun krater tubi milliardlab yillardan beri soyada va bizga ma’lum eng sovuq joylardan biri — −173 °C dan ham ancha sovuq.', apollo_info: 'Apollon {n} bu yerga {y}-yilda qo‘ndi.', help_map: 'M — Oy xaritasi (haqiqiy Oyda qayerdasiz)',
    kidTitleS: 'Missiya tushuntirishi: Quyosh radiatsiya bo‘roni', kidStorm: ['Xush kelibsiz, yosh kosmonavt! Siz tashqaridasiz, Oy bazasi yaqinida.', 'Tez orada Quyosh quyosh bo‘ronini chiqaradi. Ekranda 45 soniyalik taymerli qizil ogohlantirish paydo bo‘ladi.', 'Kostyum va yupqa devorlar quyosh bo‘ronini to‘xtata olmaydi! Agar bo‘ron sizni tashqarida ushlasa, ekranni oq shovqin qoplaydi, radiatsiya hisoblagichi baland chiqillaydi va salomatlik tez kamayadi.', 'Bazaga yuguring! Yugurish uchun Shift ni bosib turing. Bazaning o‘rtasida dumaloq Bo‘ron boshpanasi bor.', 'Boshpananing devorlari ichi bo‘sh. Ikkita suv jo‘mragiga boring va har birida E ni 5 soniya bosib turib, devorlarga suv quying.', 'Mana ilm: suv radiatsiyani metalldan yaxshiroq to‘xtatadi! Suvda vodorod ko‘p, u bo‘ronning mayda zarralarini yutib oladi.', 'Ikkala devor to‘lgach, boshpana ichiga kiring. Siz xavfsizsiz va salomatligingiz tiklanadi.', 'Tayyormisiz? Boshlash tugmasini bosing. Omad!'], st_warnT: 'QUYOSH BO‘RONI YAQINLASHMOQDA', st_hitT: 'QUYOSH BO‘RONI! RADIATSIYA YUQORI', st_msg: 'Kostyum va yupqa devorlar quyosh bo‘ronini to‘xtata olmaydi! Bo‘ron boshpanasiga boring!', st_hitSay: 'Quyosh bo‘roni keldi! Boshpanaga kiring va devorlarini suv bilan to‘ldiring!', st_safe: 'Suv devorlar radiatsiyani to‘smoqda. Ichkarida qoling!', obj_survey: 'Baza atrofini ko‘zdan kechiring', sobj_run: 'Bazaga yuguring — Bo‘ron boshpanasiga!', sobj_valve: '{n}-suv jo‘mragida E ni bosib turib, devorni to‘ldiring', sobj_enter: 'Bo‘ron boshpanasi ichiga kiring', sobj_wait: 'Siz xavfsizsiz. Ichkarida qoling — bo‘ron kelmoqda', sobj_ok: 'Himoyalangansiz! Ichkarida qoling — salomatlik tiklanmoqda', walls: 'Boshpana devorlari', tgt_shelter: 'Boshpana', tgt_valve: '{n}-jo‘mrak', p_valve: 'E ni bosib turing — {n}-devorga suv quyish ({p}%)', a_valve: '{n}-devorga suv quyilmoqda…', st_wallFull: '{n}-devor suvga to‘ldi!', storm_in: 'Bo‘ronga', lose_storm: 'Quyosh bo‘roni radiatsiyasi juda kuchli edi. Keyingi safar darhol boshpanaga yuguring va devorlarini suv bilan to‘ldiring.', swinT: 'Siz quyosh bo‘ronidan omon qoldingiz!', swinD: 'Suv devorlar radiatsiyani to‘sib, sizni himoya qildi (vaqt {t}). Suvda vodorod ko‘p va u bo‘ronning mayda zarralarini metalldan yaxshiroq to‘xtatadi — zarralar urilganda metall hatto qo‘shimcha radiatsiya hosil qilishi mumkin. Shuning uchun olimlar kelajakdagi Oy bazalarini suv va Oy tuprog‘i bilan himoyalashni xohlashadi.', site3_name: 'Dekart tog‘liklari (Apollon 16)', site3_info: 'Apollon 16 kosmonavtlari bu yerni 1972-yil aprelida o‘rgandilar. Atigi to‘rt oydan so‘ng, 1972-yil avgustda, kosmik asrning eng kuchli quyosh bo‘ronlaridan biri Oyga urildi. Bu yerda turgan odamga bo‘ron boshpanasi kerak bo‘lardi.',
    clock: 'Oy vaqti', t_out: 'Tashqarida', t_suit: 'Kostyum', ph_day: 'Kunduz', ph_night: 'Tun', ph_dawn: 'Tong', ph_dusk: 'Shom',
    w_cold: 'KOSTYUM MUZLAYAPTI — quyosh nuriga yoki oyna nuriga chiqing!', w_hot: 'KOSTYUM O‘TA QIZIYAPTI — soyaga yoki roverga o‘ting!',
    w_dark: 'Krater soyasi: issiqlikni ushlab turadigan havo yo‘q — −173 °C! Qirg‘oqqa oynalar qo‘ying.',
    lose_cold: 'Kosmonavt krater soyasida muzlab qoldi.', lose_heat: 'Kosmonavt quyosh nurida haddan ziyod qizib ketdi.',
    mirrors: 'Oynalar', tower: 'Minora ta’miri', in_pack: 'ryukzakda', placed: 'o‘rnatildi',
    mobj_drive: 'Singan minorali qorong‘i kraterga boring', mobj_mirror: 'Krater qirg‘og‘iga oynalarni o‘rnating ({n} / 3)',
    mobj_tower: 'Pastga tushib, minorani ta’mirlang', tgt_spot: 'Oyna joyi', tgt_tower: 'Minora',
    p_mirror: 'E bosing — ulkan oyna o‘rnatish', p_repair: 'E bosing — minorani ta’mirlash (to‘xtatish uchun yuring)',
    a_mirror: 'Oyna o‘rnatilmoqda…', a_repair: 'Minora ta’mirlanmoqda…',
    f_mirror: '{n} / 3 oyna tayyor — quyosh nuri kraterga tushdi!', f_tower: 'Minora ta’mirlandi — aloqa tiklandi!',
    mhelpGoal: 'O‘LIMLI SOYA. Chuqur va qorong‘i krater ichida aloqa minorasi sindi. Quyosh nurida kostyum xavfli darajada qiziydi, krater soyasida esa −173 °C: energiya va salomatlik tez muzlaydi. Quyoshli qirg‘oqqa 3 ta ulkan oynani (E) o‘rnating — ular nurni minoraga qaytaradi. So‘ng pastga tushib, nur isitib turganda minorani ta’mirlang. Bazada dam oling va davolaning (pul evaziga).',
    mwinT: 'Minora ta’mirlandi!', mwinD: 'Oynalar qorong‘i kraterni iliq ish joyiga aylantirdi va siz aloqani {t} ichida tikladingiz. Oyda issiqlikni ushlab turadigan havo yo‘q: quyoshda +121 °C gacha qiziydi, soyada −173 °C gacha muzlaydi. Yerning ko‘rinmas atmosferasi — kun va tunimizni qulay qiladigan ko‘rpa.'
  },
  ru: {
    health: 'Здоровье', oxygen: 'Кислород', energy: 'Энергия', radiation: 'Радиация', rover: 'Ровер',
    delivered: 'Доставлено образцов', carrying: 'Рюкзак', cargo: 'Груз ровера', kmh: 'км/ч',
    st_ok: 'Безопасно', st_fatigue: 'Усталость', st_illness: 'Лучевая болезнь', st_injury: 'Лучевая травма',
    obj_getRover: 'Подойдите к роверу и сядьте в него', obj_drive: 'Езжайте к светящемуся кратеру',
    obj_collect: 'Соберите светящиеся образцы породы', obj_load: 'Погрузите образцы в ровер',
    obj_return: 'Возвращайтесь в лабораторию', obj_store: 'Загрузите камни в кислородную машину',
    obj_walkRover: 'Вернитесь к роверу', obj_exitLab: 'Выйдите из лаборатории',
    tgt_lab: 'Лаборатория', tgt_rover: 'Ровер', tgt_rock: 'Образец',
    p_enter: 'Нажмите E — сесть в ровер', p_exit: 'Нажмите E — выйти из ровера',
    p_collect: 'Нажмите E — взять образец', p_load: 'Нажмите E — погрузить образцы в ровер',
    p_store: 'Нажмите E — загрузить камни в кислородную машину',
    a_collect: 'Сбор образца…', a_load: 'Погрузка в ровер…', a_store: 'Загрузка кислородной машины…',
    w_flareSoon: 'Солнечная вспышка через {s} с — найдите укрытие!',
    w_flare: 'СОЛНЕЧНАЯ ВСПЫШКА — радиация x3,5! Спрячьтесь в лаборатории или в кратере.',
    w_o2: 'Мало кислорода! Вернитесь в лабораторию.', w_en: 'Энергия закончилась — ровер едва ползёт!',
    w_edge: 'Вы покидаете карту. Поверните назад.', w_rad: 'Высокая радиация! Идите в лабораторию.',
    m_refill: 'Лаборатория: скафандр заправляется из кислородного бака базы',
    m_repair: 'Лаборатория: ровер ремонтируется',
    money: 'Деньги', f_broke: 'Недостаточно денег!', f_earn: '+${m} — образцы сданы',
    s_heal: 'Нажмите <kbd>H</kbd> — полностью вылечиться ({c})', s_healing: 'Лечение… нажмите <kbd>H</kbd>, чтобы остановить',
    s_repair: 'Нажмите <kbd>R</kbd> — починить ровер ({c})', s_repairing: 'Ремонт ровера… нажмите <kbd>R</kbd>, чтобы остановить',
    w_hit: 'Столкновение! Ровер −{d}%', w_rv1: 'Ровер сильно повреждён — объезжайте камни, почините его в лаборатории.', w_rv0: 'Ровер разбит — он может лишь ползти. Почините его в лаборатории.',
    v_first: 'ВИД ОТ ПЕРВОГО ЛИЦА', v_third: 'ВИД ОТ ТРЕТЬЕГО ЛИЦА',
    helpTitle: 'ЛУННАЯ МИССИЯ',
    help: ['W / S — идти или ехать вперёд / назад', 'A / D — поворот влево / вправо',
      'Пробел — прыжок · Shift — бег · B — тормоз', 'E — действие (ровер, камни, лаборатория)',
      'C — вид от 3-го / 1-го лица', 'В базе: E — кислородная машина · H — медотсек · R — мастерская (за деньги)', 'Перетаскивайте мышь — осмотр · Колесо — масштаб', 'M — карта Луны (где ты на настоящей Луне)', 'Esc — пауза'],
    helpGoal: 'Езжайте к светящимся кратерам, собирайте образцы породы, грузите их в ровер и сдайте 12 образцов в лабораторию. Снаружи солнечная радиация вредит здоровью, а кислород и энергия убывают — для восстановления возвращайтесь в лабораторию. Камни повреждают ровер. Пройдите через шлюз в базу: сдавайте образцы на склад (E), зарабатывайте деньги и тратьте их в медотсеке (H) и мастерской (R).',
    begin: 'НАЧАТЬ МИССИЮ', loading: 'Создаём Луну…',
    paused: 'ПАУЗА', resume: 'ПРОДОЛЖИТЬ', quit: 'К УРОВНЯМ',
    winT: 'Открытие совершено!', winD: '{d} Вы доставили образцов: {n}, время: {t}.',
    loseT: 'Миссия провалена', lose_rad: 'Лучевая болезнь погубила астронавта.', lose_o2: 'У астронавта закончился кислород. В следующий раз поворачивай назад, пока шкала кислорода не дошла до белой черты.',
    again: 'ИГРАТЬ СНОВА', site: 'Кратер', lab: 'ЛАБ',
    kidTitle: 'Инструктаж для юных астронавтов', kidTitleM: 'Инструктаж: Смертельная тень', readAloud: '🔊 Прочитать вслух', stopRead: '⏹ Остановить', controls: 'Управление',
    kidMoon: ['Добро пожаловать, юный астронавт! На нашей лунной базе заканчивается воздух для дыхания.', 'На Луне нет воздуха. В твоём скафандре маленький баллон с кислородом, а на базе — один большой кислородный бак.', 'Вот секрет: лунные камни почти наполовину состоят из кислорода! Он заперт внутри камня, и кислородная машина на базе умеет его извлекать.', 'Твоя задача: собери светящиеся камни, привези их на базу и загрузи в кислородную машину. Наполни бак базы до 100 процентов.', 'Следи за шкалой кислорода. Таймер показывает, на сколько хватит воздуха, а белая черта — сколько воздуха нужно, чтобы вернуться домой. Всегда поворачивай назад, пока кислород не дошёл до черты!', 'Когда бежишь, дышишь чаще и тратишь больше кислорода. Ровер быстрый, поэтому на нём каждая поездка тратит меньше воздуха.', 'На базе лаборатория заправляет скафандр из большого бака. Каждая заправка тратит кислород базы, поэтому не трать его зря.', 'Ходи клавишами W, A, S и D, прыгай пробелом и нажимай E, чтобы поднять камень и сесть в ровер.', 'Готов? Нажми кнопку «Начать». Удачи!'],
    kidShadow: ['Добро пожаловать, юный астронавт! В глубоком тёмном кратере сломалась башня связи.', 'На солнце твой скафандр сильно нагревается. А в тени кратера минус 173 градуса! Энергия и здоровье быстро замерзают.', 'Вот секрет. На Земле воздух работает как одеяло и сохраняет тепло. На Луне воздуха нет, поэтому на солнце кипяток, а в тени мороз.', 'Твой план: поезжай на ровере к кратеру. Подойди к каждому светящемуся месту на солнечном краю и нажми E, чтобы поставить гигантское зеркало. У тебя три зеркала.', 'Зеркала отразят солнечный свет в тёмный кратер и создадут тёплое светлое пятно вокруг башни.', 'Теперь спустись вниз, встань в тёплый свет и нажми E у башни, чтобы начать ремонт. Если отойдёшь, ремонт встанет на паузу — можно согреться и вернуться.', 'Ходи клавишами W, A, S и D, прыгай пробелом, действуй клавишей E. Клавиша C меняет камеру.', 'Готов? Нажми кнопку «Начать». Удачи!'],
    tank: 'Кислородный бак базы', o2home: 'Путь домой: нужно ~{n}%', obj_fill: 'Кислородный бак базы: {n}%', maker: 'Кислородная машина', heating: 'греются камни: {n}', idle: 'готова', rocks: 'Сдано камней', obj_home: 'Вернитесь и пополните кислород', w_turn: 'НЕМЕДЛЕННО ПОВОРАЧИВАЙ! У тебя {a}% кислорода — на дорогу домой нужно около {b}%.', w_soon: 'Скоро пора домой — кислород приближается к белой черте.', w_tank0: 'Бак базы ПУСТ — лаборатория не может заправить скафандр! Резервная система делает воздух очень медленно. Привези камни!', w_tankLow: 'Бак базы почти пуст — скорее привези камни!', f_oxy: '+{o}% кислорода базы · +${m}', f_newRocks: 'В кратерах найдены новые светящиеся камни!', tip_out: 'Теперь ты снаружи. Скафандр тратит кислород — следи за таймером рядом с «Кислород».', tip_run: 'Когда бежишь, дышишь чаще: кислород уходит почти вдвое быстрее.', tip_rover: 'Ровер быстрый, поэтому каждая поездка тратит меньше кислорода. Езди, чтобы беречь воздух!', tip_half: 'Половина кислорода израсходована. Держи шкалу кислорода выше белой черты — столько нужно, чтобы вернуться домой.', tip_rock: 'Этот тёмный лавовый камень почти наполовину состоит из кислорода, запертого в минералах!', tip_maker: 'Кислородная машина нагревает камни и извлекает из них кислород. Смотри, как наполняется бак базы!', tip_refill: 'Лаборатория заправляет скафандр из бака базы. Каждая заправка тратит кислород базы.', winT1: 'База снова дышит!', winD1: 'Ты добыл из лунных камней достаточно кислорода, чтобы наполнить бак базы (камней: {n}, время {t}). Лунные камни примерно на 40–45 % по массе состоят из кислорода — он заперт в минералах, которые образовались в древней лаве. Будущие астронавты собираются так получать воздух для дыхания и ракетное топливо.',
    map_title: 'КАРТА ЛУНЫ', map_sub: 'Настоящая фотокарта всей Луны, снятая аппаратом NASA, который летает вокруг Луны', map_btn: 'КАРТА', map_close: 'ЗАКРЫТЬ', map_credit: 'Карта: Центр космических полётов NASA имени Годдарда / Университет штата Аризона · M или Esc — закрыть', map_here: 'ТЫ ЗДЕСЬ', map_lvl: 'Уровень {n}', map_near: 'Видимая сторона (к Земле)', map_far: 'Обратная сторона', map_hint: 'Нажми на отметку, чтобы узнать о месте.', site1_name: 'Долина Тавр–Литтров (Аполлон-17)', site1_info: 'Эту долину залила древняя лава. В 1972 году астронавты «Аполлона-17» нашли здесь оранжевые стеклянные шарики, созданные вулканическими «огненными фонтанами». В здешней тёмной лаве много минерала, из которого можно извлечь кислород. Поэтому наша кислородная база здесь.', site2_name: 'Кратер Шеклтон, южный полюс', site2_info: 'Около 21 км в ширину и глубже 4 км. На полюсе Солнце всегда стоит очень низко, поэтому дно кратера миллиарды лет находится в тени и это одно из самых холодных известных мест — гораздо холоднее −173 °C.', apollo_info: '«Аполлон-{n}» сел здесь в {y} году.', help_map: 'M — карта Луны (где ты на настоящей Луне)',
    kidTitleS: 'Инструктаж: Солнечная радиационная буря', kidStorm: ['Добро пожаловать, юный астронавт! Ты снаружи, рядом с лунной базой.', 'Скоро Солнце выбросит солнечную бурю. Появится красное предупреждение с таймером на 45 секунд.', 'Скафандр и тонкие стены не могут остановить солнечную бурю! Если она застанет тебя снаружи, экран покроют белые помехи, счётчик радиации будет громко трещать, а здоровье будет быстро падать.', 'Беги на базу! Держи Shift, чтобы бежать. В центре базы стоит круглое штормовое убежище.', 'У убежища полые стены. Подойди к двум водяным вентилям и держи E по 5 секунд на каждом, чтобы закачать воду в стены.', 'Вот наука: вода задерживает радиацию лучше металла! В воде много водорода, который поглощает крошечные частицы бури.', 'Когда обе стены заполнены, зайди в убежище. Ты в безопасности, и здоровье восстанавливается.', 'Готов? Нажми кнопку «Начать». Удачи!'], st_warnT: 'ПРИБЛИЖАЕТСЯ СОЛНЕЧНАЯ БУРЯ', st_hitT: 'СОЛНЕЧНАЯ БУРЯ! ВЫСОКАЯ РАДИАЦИЯ', st_msg: 'Скафандр и тонкие стены не остановят солнечную бурю! Беги в штормовое убежище!', st_hitSay: 'Солнечная буря пришла! Беги в убежище и заполни его стены водой!', st_safe: 'Водяные стены задерживают радиацию. Оставайся внутри!', obj_survey: 'Осмотрись рядом с базой', sobj_run: 'Беги на базу — в штормовое убежище!', sobj_valve: 'Держи E у водяного вентиля {n}, чтобы заполнить стену', sobj_enter: 'Зайди в штормовое убежище', sobj_wait: 'Ты в безопасности. Оставайся внутри — буря приближается', sobj_ok: 'Защищён! Оставайся внутри — здоровье восстанавливается', walls: 'Стены убежища', tgt_shelter: 'Убежище', tgt_valve: 'Вентиль {n}', p_valve: 'Держите E — качать воду в стену {n} ({p}%)', a_valve: 'Вода закачивается в стену {n}…', st_wallFull: 'Стена {n} заполнена водой!', storm_in: 'До бури', lose_storm: 'Радиация солнечной бури оказалась слишком сильной. В следующий раз сразу беги в убежище и заполняй стены водой.', swinT: 'Ты пережил солнечную бурю!', swinD: 'Водяные стены задержали радиацию и спасли тебя (время {t}). В воде много водорода, и он останавливает крошечные частицы бури лучше металла — металл при ударе частиц может даже создавать дополнительную радиацию. Поэтому учёные хотят защищать будущие лунные базы водой и лунным грунтом.', site3_name: 'Нагорье Декарта (Аполлон-16)', site3_info: 'Астронавты «Аполлона-16» исследовали это место в апреле 1972 года. Всего через четыре месяца, в августе 1972 года, Луну накрыла одна из сильнейших солнечных бурь космической эпохи. Тому, кто был бы здесь, понадобилось бы штормовое убежище.',
    clock: 'Лунное время', t_out: 'Снаружи', t_suit: 'Скафандр', ph_day: 'День', ph_night: 'Ночь', ph_dawn: 'Рассвет', ph_dusk: 'Закат',
    w_cold: 'СКАФАНДР ЗАМЕРЗАЕТ — выйдите на солнце или в луч зеркала!', w_hot: 'СКАФАНДР ПЕРЕГРЕВАЕТСЯ — уйдите в тень или в ровер!',
    w_dark: 'Тень кратера: нет воздуха, чтобы удерживать тепло — здесь −173 °C! Поставьте зеркала на кромке.',
    lose_cold: 'Астронавт замёрз в тени кратера.', lose_heat: 'Астронавт перегрелся на солнце.',
    mirrors: 'Зеркала', tower: 'Ремонт башни', in_pack: 'в рюкзаке', placed: 'установлено',
    mobj_drive: 'Езжайте к тёмному кратеру со сломанной башней', mobj_mirror: 'Поставьте зеркала на кромке кратера ({n} / 3)',
    mobj_tower: 'Спуститесь и почините башню', tgt_spot: 'Место зеркала', tgt_tower: 'Башня',
    p_mirror: 'Нажмите E — установить гигантское зеркало', p_repair: 'Нажмите E — чинить башню (двигайтесь, чтобы прервать)',
    a_mirror: 'Установка зеркала…', a_repair: 'Ремонт башни…',
    f_mirror: 'Зеркало {n} / 3 установлено — свет попал в кратер!', f_tower: 'Башня исправна — связь восстановлена!',
    mhelpGoal: 'СМЕРТЕЛЬНАЯ ТЕНЬ. В глубоком тёмном кратере сломалась башня связи. На солнце скафандр опасно нагревается, а в тени кратера −173 °C — энергия и здоровье быстро замерзают. Поставьте 3 гигантских зеркала на освещённой кромке (E), чтобы они отразили свет на башню, затем спуститесь и чините её, пока свет вас греет. Отдыхайте и лечитесь на базе (за деньги).',
    mwinT: 'Башня починена!', mwinD: 'Зеркала превратили тёмный кратер в тёплое рабочее место, и вы восстановили связь за {t}. На Луне нет воздуха, который удерживает тепло: на солнце жара до +121 °C, в тени мороз до −173 °C. Невидимая атмосфера Земли — одеяло, которое делает наши дни и ночи комфортными.'
  }
};
const SITE_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

// ----------------------------------------------------------------- math/noise
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function hash(ix, iz, s) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul((s | 0) + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, s), b = hash(ix + 1, iz, s), c = hash(ix, iz + 1, s), d = hash(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ----------------------------------------------------------------- world
const SITE_DEF = [[650, 0.9], [1100, 2.5], [1700, 4.1], [2400, 5.4], [3300, 1.6]];
const SITES = SITE_DEF.map(([d, a], i) => ({
  id: i, name: SITE_NAMES[i], x: Math.sin(a) * d, z: Math.cos(a) * d,
  R: 85 + hash(i, 7, 3) * 30, D: 14 + hash(i, 8, 3) * 6, left: 0
}));
const LAYERS = [
  { cell: 900, rmin: 110, rmax: 260, p: 0.55, s: 11, dk: 0.11 },
  { cell: 300, rmin: 30, rmax: 75, p: 0.6, s: 12, dk: 0.13 },
  { cell: 110, rmin: 9, rmax: 22, p: 0.65, s: 13, dk: 0.16 }
];
function craterH(dx, dz, R, D) {
  const t = Math.sqrt(dx * dx + dz * dz) / R;
  if (t > 2.3) return 0;
  let h = t < 1 ? -D * (1 - t * t) : 0;
  const q = (t - 1) / 0.28;
  return h + D * 0.28 * Math.exp(-q * q);
}
function heightAt(x, z) {
  let h = (vnoise(x * 0.0016, z * 0.0016, 1) - 0.5) * 36
        + (vnoise(x * 0.0045, z * 0.0045, 2) - 0.5) * 12
        + (vnoise(x * 0.012, z * 0.012, 3) - 0.5) * 4.5
        + (vnoise(x * 0.04, z * 0.04, 4) - 0.5) * 1.1;
  for (let l = 0; l < 3; l++) {
    const L = LAYERS[l];
    const cx0 = Math.floor(x / L.cell), cz0 = Math.floor(z / L.cell);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = cx0 + i, cz = cz0 + j;
      if (hash(cx, cz, L.s) > L.p) continue;
      const px = (cx + hash(cx, cz, L.s + 20)) * L.cell, pz = (cz + hash(cx, cz, L.s + 40)) * L.cell;
      const R = L.rmin + hash(cx, cz, L.s + 60) * (L.rmax - L.rmin);
      h += craterH(x - px, z - pz, R, R * (L.dk + 0.05 * hash(cx, cz, L.s + 80)));
    }
  }
  for (let k = 0; k < SITES.length; k++) {
    const s = SITES[k];
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz < (s.R * 2.4) * (s.R * 2.4)) h += craterH(dx, dz, s.R, s.D);
  }
  if (SHADOW.on) {
    const dx = x - SHADOW.x, dz = z - SHADOW.z;
    if (dx * dx + dz * dz < (SHADOW.R * 2.4) * (SHADOW.R * 2.4)) h += craterH(dx, dz, SHADOW.R, SHADOW.D);
  }
  // flat building area around the lab
  const d = Math.sqrt(x * x + z * z);
  if (d < 140) h *= smooth(60, 140, d);
  return h;
}

// is the sun hidden behind terrain? (ux,uz) = horizontal unit vector toward the sun
function sunBlocked(x, z, ux, uz, tanE) {
  const y0 = heightAt(x, z) + 1.5;
  for (let t = 3; t < 280; t *= 1.38) if (heightAt(x + ux * t, z + uz * t) > y0 + t * tanE) return true;
  return false;
}

// ----------------------------------------------------------------- textures
function makeDetailTexture() {
  const N = 512, c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
  const octs = [[8, 0.35], [16, 0.25], [32, 0.2], [64, 0.12], [128, 0.08]];
  const grids = octs.map(([s]) => { const g = new Float32Array(s * s); for (let i = 0; i < g.length; i++) g[i] = Math.random(); return g; });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (let o = 0; o < octs.length; o++) {
      const s = octs[o][0], g = grids[o];
      const fx = x / N * s, fy = y / N * s, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, x1 = (ix + 1) % s, y1 = (iy + 1) % s;
      const a = g[iy * s + ix], b = g[iy * s + x1], cc = g[y1 * s + ix], d = g[y1 * s + x1];
      v += octs[o][1] * (a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty);
    }
    const k = Math.floor(clamp(150 + v * 105, 0, 255)), p = (y * N + x) * 4;
    img.data[p] = img.data[p + 1] = img.data[p + 2] = k; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function makeEarthTexture() {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sea = g.createLinearGradient(0, 0, 0, H); sea.addColorStop(0, '#1d4f9a'); sea.addColorStop(0.5, '#1b63bf'); sea.addColorStop(1, '#1d4f9a');
  g.fillStyle = sea; g.fillRect(0, 0, W, H);
  const land = ['#3a8a4a', '#4b9a50', '#7a8a48', '#9c8a5a'];
  for (let i = 0; i < 34; i++) {
    const x = Math.random() * W, y = 70 + Math.random() * (H - 140), rx = 30 + Math.random() * 90, ry = 18 + Math.random() * 50;
    for (let k = 0; k < 9; k++) { g.fillStyle = land[(i + k) % land.length]; g.beginPath(); g.ellipse(x + (Math.random() - 0.5) * rx, y + (Math.random() - 0.5) * ry, rx * (0.3 + Math.random() * 0.5), ry * (0.3 + Math.random() * 0.5), Math.random() * 3, 0, 7); g.fill(); }
  }
  g.fillStyle = '#f2f6fb'; g.fillRect(0, 0, W, 26); g.fillRect(0, H - 30, W, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function makeCloudTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  for (let i = 0; i < 150; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.35 + Math.random() * 0.5) + ')'; g.beginPath(); g.ellipse(Math.random() * 1024, 40 + Math.random() * 432, 24 + Math.random() * 100, 5 + Math.random() * 16, (Math.random() - 0.5) * 0.7, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeDiscTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,252,238,1)'); gr.addColorStop(0.94, 'rgba(255,244,200,.55)'); gr.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ----------------------------------------------------------------- terrain chunks
function* buildTerrainGeometry(cx, cz, n) {
  const step = CS / n, x0 = cx * CS, z0 = cz * CS, m = n + 3;
  const H = new Float32Array(m * m);
  for (let j = 0; j < m; j++) { for (let i = 0; i < m; i++) H[j * m + i] = heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step); if (j % 6 === 5) yield; }
  const gv = (n + 1) * (n + 1), V = gv + 4 * (n + 1), SK = 14;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3), uv = new Float32Array(V * 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    if (i === 0 && j % 12 === 11) yield;
    const k = j * (n + 1) + i, h = H[(j + 1) * m + i + 1], x = i * step, z = j * step;
    const hl = H[(j + 1) * m + i], hr = H[(j + 1) * m + i + 2], hu = H[j * m + i + 1], hd = H[(j + 2) * m + i + 1];
    const nx = hl - hr, ny = 2 * step, nz = hu - hd, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
    const wx = x0 + x, wz = z0 + z;
    let g = 0.15 + 0.08 * vnoise(wx * 0.004, wz * 0.004, 21) + 0.045 * vnoise(wx * 0.03, wz * 0.03, 22);
    g *= 0.78 + 0.22 * (ny / l);
    col[k * 3] = g * 1.02; col[k * 3 + 1] = g * 0.99; col[k * 3 + 2] = g * 0.95;
    uv[k * 2] = wx / 7; uv[k * 2 + 1] = wz / 7;
  }
  const edges = [];
  for (let i = 0; i <= n; i++) edges.push(i);                   // top  j=0
  for (let i = 0; i <= n; i++) edges.push(n * (n + 1) + i);     // bottom j=n
  for (let j = 0; j <= n; j++) edges.push(j * (n + 1));         // left i=0
  for (let j = 0; j <= n; j++) edges.push(j * (n + 1) + n);     // right i=n
  for (let e = 0; e < edges.length; e++) {
    const src = edges[e], dst = gv + e;
    pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - SK; pos[dst * 3 + 2] = pos[src * 3 + 2];
    nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
    col[dst * 3] = col[src * 3]; col[dst * 3 + 1] = col[src * 3 + 1]; col[dst * 3 + 2] = col[src * 3 + 2];
    uv[dst * 2] = uv[src * 2]; uv[dst * 2 + 1] = uv[src * 2 + 1];
  }
  const idx = new Uint16Array(n * n * 6 + 4 * n * 6); let ip = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx[ip++] = a; idx[ip++] = c; idx[ip++] = b; idx[ip++] = b; idx[ip++] = c; idx[ip++] = d;
  }
  for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
    const e0 = side * (n + 1) + i, e1 = e0 + 1;
    idx[ip++] = edges[e0]; idx[ip++] = gv + e0; idx[ip++] = edges[e1]; idx[ip++] = edges[e1]; idx[ip++] = gv + e0; idx[ip++] = gv + e1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  yield;
  geo.computeBoundingSphere();
  return geo;
}

// ----------------------------------------------------------------- models
const M = {};
function initMaterials() {
  M.white = new THREE.MeshStandardMaterial({ color: 0xe4eaf2, roughness: 0.5, metalness: 0.25 });
  M.grey = new THREE.MeshStandardMaterial({ color: 0x8e98a6, roughness: 0.6, metalness: 0.4 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.7, metalness: 0.3 });
  M.orange = new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.5, metalness: 0.2 });
  M.solar = new THREE.MeshStandardMaterial({ color: 0x1d3f86, roughness: 0.25, metalness: 0.7 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x9fd6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false });
  M.visor = new THREE.MeshStandardMaterial({ color: 0xffc66b, roughness: 0.08, metalness: 0.9 });
  M.win = new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd98a, emissiveIntensity: 1.2 });
  M.tire = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.95, metalness: 0 });
  M.rock = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 1, flatShading: true });
  M.sample = new THREE.MeshStandardMaterial({ color: 0x2a8f9a, emissive: 0x39e6ff, emissiveIntensity: 1.1, roughness: 0.4, flatShading: true });
}
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true; return m;
}

function makeAstronaut() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const torso = mesh(new THREE.BoxGeometry(0.56, 0.62, 0.34), M.white, 0, 1.12, 0);
  const pack = mesh(new THREE.BoxGeometry(0.46, 0.58, 0.24), M.grey, 0, 1.15, -0.28);
  const helmet = mesh(new THREE.SphereGeometry(0.27, 20, 14), M.white, 0, 1.64, 0.02);
  const visor = mesh(new THREE.SphereGeometry(0.2, 16, 12), M.visor, 0, 1.65, 0.1);
  visor.scale.set(1, 0.8, 0.9);
  const belt = mesh(new THREE.BoxGeometry(0.58, 0.1, 0.36), M.orange, 0, 0.82, 0);
  body.add(torso, pack, helmet, visor, belt);
  const limb = (x, y, len, r, mat, cy) => {
    const g = new THREE.Group(); g.position.set(x, y, 0);
    const m = mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, cy === undefined ? -len / 2 - r * 0.4 : cy, 0);
    g.add(m); return g;
  };
  const armL = limb(0.38, 1.36, 0.42, 0.1, M.white), armR = limb(-0.38, 1.36, 0.42, 0.1, M.white);
  const legL = limb(0.16, 0.8, 0.54, 0.13, M.white, -0.4), legR = limb(-0.16, 0.8, 0.54, 0.13, M.white, -0.4);   // soles at y = 0
  body.add(armL, armR, legL, legR);
  return { root, body, armL, armR, legL, legR };
}

function makeRover() {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.add(mesh(new THREE.BoxGeometry(2.7, 0.55, 5.6), M.white, 0, 1.0, 0));
  body.add(mesh(new THREE.BoxGeometry(2.74, 0.12, 5.64), M.orange, 0, 0.76, 0));
  const hood = mesh(new THREE.BoxGeometry(2.3, 0.7, 1.6), M.grey, 0, 1.55, 2.0); body.add(hood);   // hood
  const cabin = mesh(new THREE.BoxGeometry(2.3, 1.15, 2.1), M.glass, 0, 1.88, 0.35, false);
  body.add(cabin);
  [[-1.15, 0.35, 1.0], [1.15, 0.35, 1.0], [-1.15, 0.35, -0.68], [1.15, 0.35, -0.68]].forEach(([x, z]) => {
    body.add(mesh(new THREE.BoxGeometry(0.07, 1.2, 0.07), M.dark, x, 1.9, z));
  });
  body.add(mesh(new THREE.BoxGeometry(2.4, 0.07, 2.2), M.dark, 0, 2.5, 0.35));
  const seat = new THREE.Group(); seat.position.set(0, 0.55, 0.25); body.add(seat);
  const eye = new THREE.Object3D(); eye.position.set(0, 2.28, 0.25); body.add(eye);   // driver's eyes (first-person view)
  body.add(mesh(new THREE.BoxGeometry(0.7, 0.12, 0.6), M.dark, 0, 1.28, 0.2));
  body.add(mesh(new THREE.BoxGeometry(0.7, 0.7, 0.12), M.dark, 0, 1.6, -0.15));
  // cargo bed
  body.add(mesh(new THREE.BoxGeometry(2.5, 0.14, 2.3), M.grey, 0, 1.34, -1.85));
  [[-1.2, -1.85, 0.12, 2.3], [1.2, -1.85, 0.12, 2.3]].forEach(([x, z, w, l]) => body.add(mesh(new THREE.BoxGeometry(w, 0.5, l), M.grey, x, 1.55, z)));
  body.add(mesh(new THREE.BoxGeometry(2.5, 0.5, 0.12), M.grey, 0, 1.55, -3.0));
  // solar panel + antenna
  const panel = mesh(new THREE.BoxGeometry(2.0, 0.06, 1.5), M.solar, 0, 2.75, 0.35); body.add(panel);
  body.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), M.dark, -0.9, 3.0, -1.0));
  body.add(mesh(new THREE.SphereGeometry(0.1, 8, 6), M.orange, -0.9, 3.65, -1.0));
  // lights
  [-0.95, 0.95].forEach(x => body.add(mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), M.win, x, 1.1, 2.82, false)));
  const spot = new THREE.SpotLight(0xfff2d8, 900, 160, 0.5, 0.6, 1.6);
  spot.position.set(0, 1.3, 2.7); spot.target.position.set(0, 0.2, 40);
  body.add(spot); body.add(spot.target);
  // wheels
  const wheels = [];
  const wg = new THREE.CylinderGeometry(0.72, 0.72, 0.55, 20); wg.rotateZ(Math.PI / 2);
  [[-1.6, 2.0], [1.6, 2.0], [-1.6, 0.0], [1.6, 0.0], [-1.6, -2.0], [1.6, -2.0]].forEach(([x, z]) => {
    const w = new THREE.Group(); w.position.set(x, 0.72, z);
    const t = mesh(wg, M.tire); const hub = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.58, 10).rotateZ(Math.PI / 2), M.grey);
    w.add(t, hub); body.add(w); wheels.push(w);
  });
  // cargo rocks
  const cargoRocks = [];
  const rg = new THREE.DodecahedronGeometry(0.3, 0);
  for (let i = 0; i < CAP_CARGO; i++) {
    const r = mesh(rg, M.sample, -0.7 + (i % 3) * 0.7, 1.55 + Math.floor(i / 9) * 0.3, -2.45 + Math.floor((i % 9) / 3) * 0.7);
    r.rotation.set(i, i * 2, i * 3); r.visible = false; body.add(r); cargoRocks.push(r);
  }
  return { root, body, seat, eye, hood, wheels, cargoRocks, spot };
}

function makeLab() {
  const g = new THREE.Group();
  // hollow dome with a doorway on +z (the airlock leads into it)
  const GAP = 0.36, GAPC = Math.PI / 2;
  const domeMat = M.white.clone(); domeMat.side = THREE.DoubleSide;
  const dome = mesh(new THREE.SphereGeometry(10, 40, 18, GAPC + GAP / 2, Math.PI * 2 - GAP, 0, Math.PI / 2), domeMat, 0, 1.2, 0); dome.receiveShadow = false;
  const arch = mesh(new THREE.SphereGeometry(10, 8, 4, GAPC - GAP / 2, GAP, 0, 1.35), domeMat, 0, 1.2, 0); arch.receiveShadow = false;
  g.add(dome, arch);
  const ringMat = M.grey.clone(); ringMat.side = THREE.DoubleSide;
  g.add(mesh(new THREE.CylinderGeometry(10.4, 10.8, 1.4, 40, 1, true, GAP / 2, Math.PI * 2 - GAP), ringMat, 0, 0.7, 0, false));
  // floors
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x59616f, roughness: 0.65, metalness: 0.3 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(10.3, 48), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.1; floor.receiveShadow = true; g.add(floor);
  const floor2 = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 7.6), floorMat); floor2.rotation.x = -Math.PI / 2; floor2.position.set(0, 0.1, 13.1); floor2.receiveShadow = true; g.add(floor2);
  [[4.4, 0.18], [8.6, 0.12]].forEach(([r, w]) => { const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 64), new THREE.MeshBasicMaterial({ color: 0xff7a2f, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = 0.12; g.add(m); });
  // interior lighting
  const l1 = new THREE.PointLight(0xfff0dc, 150, 28, 1.8); l1.position.set(0, 8.5, 0); g.add(l1);
  const l2 = new THREE.PointLight(0xdff3ff, 60, 14, 1.8); l2.position.set(0, 3.8, 13.1); g.add(l2);
  const lamp = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: 0xfff3d0 })); lamp.rotation.x = Math.PI / 2; lamp.position.y = 10.3; g.add(lamp);
  // windows ring
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const w = mesh(new THREE.BoxGeometry(1.3, 0.8, 0.25), M.win, Math.sin(a) * 9.6, 4.2, Math.cos(a) * 9.6, false);
    w.rotation.y = a; g.add(w);
  }
  // modules
  [[-1, 0], [1, 0], [0, -1]].forEach(([dx, dz], i) => {
    const mod = mesh(new THREE.CylinderGeometry(3.4, 3.4, 11, 20), M.white, 0, 0, 0);
    mod.rotation.z = Math.PI / 2; mod.rotation.y = dz ? Math.PI / 2 : 0;
    mod.position.set(dx * 17, 3.5, dz * 17); g.add(mod);
    const cap = mesh(new THREE.SphereGeometry(3.4, 16, 10), M.white, dx * 22.4, 3.5, dz * 22.4); g.add(cap);
    const tube = mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 12), M.grey, dx * 11.5, 2.6, dz * 11.5);
    tube.rotation.z = Math.PI / 2; tube.rotation.y = dz ? Math.PI / 2 : 0; g.add(tube);
    const stripe = mesh(new THREE.CylinderGeometry(3.45, 3.45, 1.2, 20), M.orange, dx * 17, 3.5, dz * 17);
    stripe.rotation.z = Math.PI / 2; stripe.rotation.y = dz ? Math.PI / 2 : 0; g.add(stripe);
  });
  // airlock: a hollow room with a sliding door
  [-3.1, 3.1].forEach(x => g.add(mesh(new THREE.BoxGeometry(0.4, 4.6, 7.6), M.white, x, 2.3, 13.1)));
  [-2.4, 2.4].forEach(x => g.add(mesh(new THREE.BoxGeometry(1.8, 4.6, 0.4), M.white, x, 2.3, 16.7)));
  g.add(mesh(new THREE.BoxGeometry(3.0, 1.9, 0.4), M.white, 0, 3.65, 16.7));                    // lintel above the door
  g.add(mesh(new THREE.BoxGeometry(6.6, 0.3, 7.8), M.white, 0, 4.45, 13.1));                    // roof
  g.add(mesh(new THREE.BoxGeometry(6.8, 0.2, 7.9), M.orange, 0, 4.7, 13.1));
  [-1.55, 1.55].forEach(x => g.add(mesh(new THREE.BoxGeometry(0.12, 2.7, 0.55), M.orange, x, 1.35, 16.7)));
  g.add(mesh(new THREE.BoxGeometry(3.0, 0.15, 0.15), M.win, 0, 3.2, 16.95, false));
  g.add(mesh(new THREE.BoxGeometry(2.0, 0.1, 0.5), M.win, 0, 4.25, 13.1, false));
  const door = mesh(new THREE.BoxGeometry(2.96, 2.6, 0.2), M.dark, 0, 1.4, 16.7);
  g.add(door);
  // ---- interior: hologram table, medical bay, storage, workshop
  const mk = (w, h, d, m, x, y, z, ry = 0) => { const o = mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z); o.rotation.y = ry; g.add(o); return o; };
  const sign = (text, color, x, y, z, ry, w = 2.6) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 160; const k = c.getContext('2d');
    k.fillStyle = '#0c1628'; k.fillRect(0, 0, 640, 160); k.strokeStyle = color; k.lineWidth = 10; k.strokeRect(6, 6, 628, 148);
    k.fillStyle = color; k.font = '700 80px sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText(text, 320, 84, 600);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t })); p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
  };
  const holoMat = new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.55 });
  const table = new THREE.Group(); g.add(table);
  table.add(mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.9, 28), M.dark, 0, 0.55, 0));
  table.add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.06, 28), holoMat, 0, 1.03, 0, false));
  const holo = mesh(new THREE.SphereGeometry(0.6, 22, 14), M.sample, 0, 1.9, 0, false); table.add(holo);
  // medical bay (west)
  mk(1.6, 0.55, 3.2, M.white, MED.x, 0.4, MED.z); mk(1.4, 0.18, 3.0, M.grey, MED.x, 0.74, MED.z);
  mk(0.2, 2.4, 3.6, M.white, -8.5, 1.3, MED.z);
  mk(0.06, 0.3, 1.1, new THREE.MeshBasicMaterial({ color: 0x5dffa0 }), -8.38, 1.7, MED.z); mk(0.06, 1.1, 0.3, new THREE.MeshBasicMaterial({ color: 0x5dffa0 }), -8.38, 1.7, MED.z);
  sign('MEDICAL  H', '#5dffa0', -8.38, 2.7, MED.z, Math.PI / 2);
  // storage rack (east)
  mk(1.0, 2.4, 3.6, M.dark, STORE.x + 0.2, 1.3, STORE.z);
  [0.7, 1.4, 2.1].forEach(y => mk(0.06, 0.1, 3.3, new THREE.MeshBasicMaterial({ color: 0x66e6ff }), STORE.x - 0.31, y, STORE.z));
  [[0.45, -1.1], [0.45, 0.2], [1.15, -0.5], [1.15, 1.0], [1.85, 0.2]].forEach(([y, dz], i) => mk(0.4, 0.4, 0.55, i % 2 ? M.orange : M.grey, STORE.x - 0.4, y, STORE.z + dz));
  sign('OXYGEN MAKER  E', '#ffb070', STORE.x - 0.33, 2.9, STORE.z, -Math.PI / 2);
  const makerGlow = mk(0.06, 0.22, 3.3, new THREE.MeshBasicMaterial({ color: 0x3a2a22 }), STORE.x - 0.33, 2.45, STORE.z);
  // the base oxygen tank (fills as rocks are turned into oxygen)
  g.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.5, 22, 1, true), M.glass, 7.6, 1.35, -1.5, false));
  g.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.16, 22), M.grey, 7.6, 0.1, -1.5));
  g.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.16, 22), M.grey, 7.6, 2.62, -1.5));
  const fillGeo = new THREE.CylinderGeometry(0.54, 0.54, 1, 22); fillGeo.translate(0, 0.5, 0);
  const tankFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0x8ec5d6, transparent: true, opacity: 0.85 }));
  tankFill.position.set(7.6, 0.18, -1.5); g.add(tankFill);
  { const pipe = mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), M.grey, 7.25, 2.2, -0.35, false); pipe.rotation.x = Math.PI / 2; g.add(pipe); }
  sign('BASE OXYGEN', '#8ec5d6', 6.95, 2.95, -1.5, -Math.PI / 2, 1.5);
  // workshop (north wall)
  mk(3.2, 1.0, 0.9, M.dark, WORKSHOP.x, 0.6, WORKSHOP.z - 0.5); mk(3.4, 2.2, 0.2, M.grey, 0, 1.2, -8.55);
  mk(2.6, 0.9, 0.06, new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.7 }), 0, 1.7, -8.4);
  sign('WORKSHOP  R', '#ffb54d', 0, 2.9, -8.4, 0);
  // solar farm
  for (let r = 0; r < 2; r++) for (let i = -2; i <= 2; i++) {
    const p = mesh(new THREE.BoxGeometry(6, 0.18, 3.4), M.solar, 34 + r * 7, 2.2, i * 5.2);
    p.rotation.z = -0.55; g.add(p);
    g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6), M.grey, 34 + r * 7, 1.1, i * 5.2));
  }
  // dish antenna
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.4, 9, 8), M.grey, -14, 4.5, 22));
  const dish = mesh(new THREE.SphereGeometry(3, 18, 8, 0, Math.PI * 2, 0, 0.9), M.white, -14, 9.5, 22);
  dish.rotation.set(-0.9, 0.4, 0); g.add(dish);
  // tank
  g.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 6, 16), M.white, 20, 3, 18));
  g.add(mesh(new THREE.CylinderGeometry(2.25, 2.25, 0.8, 16), M.orange, 20, 4.2, 18));
  // landing-pad lights
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), M.win, Math.sin(a) * LAB_RADIUS, 0.25, Math.cos(a) * LAB_RADIUS, false));
  }
  // ---- base upgrade: landing pad, ribbed dome, lamp posts, flag, sign, crates
  const pad = mesh(new THREE.CylinderGeometry(27, 27, 0.06, 64), M.dark, 0, 0.03, 0, false); pad.receiveShadow = true; g.add(pad);
  [[26.2, 0.5], [19, 0.3], [12.4, 0.3]].forEach(([r, w]) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 64), new THREE.MeshBasicMaterial({ color: 0xff7a2f, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.075; g.add(m);
  });
  [0.55, 1.05].forEach(a => {                                    // ribs around the dome
    const rr = 10 * Math.sin(a) + 0.05, rib = mesh(new THREE.TorusGeometry(rr, 0.13, 8, 48), M.orange, 0, 1.2 + 10 * Math.cos(a), 0, false);
    rib.rotation.x = Math.PI / 2; g.add(rib);
  });
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.2, 5, 8), M.grey, 0, 13.6, 0));                // roof mast
  g.add(mesh(new THREE.SphereGeometry(0.35, 12, 8), M.orange, 0, 16.3, 0, false));
  for (let i = 0; i < 8; i++) {                                  // lamp posts
    const a = (i + 0.5) / 8 * Math.PI * 2, x = Math.sin(a) * 27, z = Math.cos(a) * 27;
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.16, 5, 8), M.grey, x, 2.5, z));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), M.win, x, 5.1, z, false));
  }
  // flag (an invented one: blue field with an orange moon)
  { const c = document.createElement('canvas'); c.width = 128; c.height = 80; const x = c.getContext('2d');
    x.fillStyle = '#12264f'; x.fillRect(0, 0, 128, 80); x.fillStyle = '#ff7a2f'; x.beginPath(); x.arc(64, 40, 24, 0, 7); x.fill();
    x.fillStyle = '#12264f'; x.beginPath(); x.arc(74, 34, 20, 0, 7); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 8), M.grey, 8, 4.5, 22));
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    fl.position.set(9.7, 7.9, 22); g.add(fl);
    g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), M.orange, 8, 9.1, 22, false)); }
  // sign on the airlock roof
  { const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d');
    x.fillStyle = '#0c1628'; x.fillRect(0, 0, 512, 96); x.strokeStyle = '#ff7a2f'; x.lineWidth = 6; x.strokeRect(4, 4, 504, 88);
    x.fillStyle = '#9fe9ff'; x.font = '700 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('MOON BASE', 256, 52);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    g.add(mesh(new THREE.BoxGeometry(6.2, 1.2, 0.2), M.dark, 0, 5.45, 15.6));
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(5.9, 1.1), new THREE.MeshBasicMaterial({ map: t }));
    sg.position.set(0, 5.45, 15.71); g.add(sg); }
  // cargo crates
  [[-8.6, 19.0, 1.5, M.orange], [-7.7, 21.0, 1.5, M.grey], [-8.2, 20.0, 1.2, M.grey]].forEach(([x, z, sz, m], i) => {
    const cr = mesh(new THREE.BoxGeometry(sz, sz, sz), m, x, sz / 2 + (i === 2 ? 1.5 : 0), z); cr.rotation.y = i * 0.5; g.add(cr);
  });

  // refill zone ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(LAB_RADIUS - 0.5, LAB_RADIUS + 0.5, 64),
    new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; g.add(ring);
  // beacon
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 160, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x55dfff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  beam.position.y = 80; g.add(beam);
  return { group: g, door, holo, table, tankFill, makerGlow };
}

// ----------------------------------------------------------------- audio
class Sfx {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ok = !!AC; if (!this.ok) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.vol = 0.7; this.master.gain.value = this.vol * 0.35;
    this.eng = this.ctx.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 45;
    this.engF = this.ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 220;
    this.engG = this.ctx.createGain(); this.engG.gain.value = 0;
    this.eng.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.master); this.eng.start();
  }
  setVolume(v) { if (this.ok) { this.vol = v; this.master.gain.value = v * 0.35; } }
  drive(speedFrac, on) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.eng.frequency.setTargetAtTime(38 + speedFrac * 70, t, 0.1);
    this.engF.frequency.setTargetAtTime(160 + speedFrac * 340, t, 0.1);
    this.engG.gain.setTargetAtTime(on ? 0.05 + speedFrac * 0.1 : 0, t, 0.15);
  }
  beep(f, d = 0.12, type = 'sine', g = 0.25, delay = 0) {
    if (!this.ok || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), gn = this.ctx.createGain();
    o.type = type; o.frequency.value = f; gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(gn); gn.connect(this.master); o.start(t); o.stop(t + d + 0.02);
  }
  chime() { this.beep(660, 0.15, 'triangle'); this.beep(880, 0.2, 'triangle', 0.25, 0.1); this.beep(1320, 0.3, 'triangle', 0.2, 0.2); }
  crash() { this.beep(70, 0.28, 'square', 0.3); this.beep(140, 0.2, 'sawtooth', 0.22, 0.02); this.beep(900, 0.08, 'square', 0.1, 0.01); }
  pick() { this.beep(520, 0.1, 'square', 0.12); this.beep(780, 0.14, 'square', 0.12, 0.08); }
  alarm() { this.beep(440, 0.18, 'sawtooth', 0.18); this.beep(330, 0.18, 'sawtooth', 0.18, 0.2); }
  click(g = 0.8) {                     // Geiger-counter tick
    if (!this.ok || this.ctx.state !== 'running') return;
    if (!this.nb) { const n = Math.floor(this.ctx.sampleRate * 0.006); this.nb = this.ctx.createBuffer(1, n, this.ctx.sampleRate); const d = this.nb.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    const src = this.ctx.createBufferSource(), gn = this.ctx.createGain(); src.buffer = this.nb; gn.gain.value = g; src.connect(gn); gn.connect(this.master); src.start();
  }
  resume() { if (this.ok && this.ctx.state === 'suspended') this.ctx.resume(); }
  close() { if (this.ok) { try { this.eng.stop(); this.ctx.close(); } catch (e) { /* ignore */ } } }
}

// ----------------------------------------------------------------- HUD / DOM
const CSS = `
.mg-root{position:absolute;inset:0;overflow:hidden;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#E2E2E2;user-select:none;-webkit-user-select:none;background:#000000}
.mg-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.mg-canvas.drag{cursor:grabbing}
.mg-glass{background:linear-gradient(160deg,rgba(70,72,77,.66),rgba(36,26,31,.78));border:1px solid rgba(212,219,219,.18);border-radius:16px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 16px 40px rgba(0,0,0,.35)}
.mg-vig{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(255,60,40,0) 45%,rgba(255,50,30,.55) 100%);transition:opacity .3s}
.mg-hurt{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(255,0,0,0) 40%,rgba(255,0,0,.5) 100%)}
.mg-stats{position:absolute;left:18px;top:18px;width:250px;padding:14px 16px}
.mg-row{margin-bottom:11px}.mg-row:last-child{margin-bottom:0}
.mg-rh{display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;margin-bottom:5px;letter-spacing:.02em}
.mg-rv{font-variant-numeric:tabular-nums;color:var(--c)}
.mg-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.mg-bar span{display:block;height:100%;width:100%;border-radius:99px;background:var(--c);transition:width .15s linear}
.mg-row.low .mg-bar span{animation:mgblink .6s infinite}
@keyframes mgblink{50%{opacity:.35}}
.mg-obj{position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:11px 20px;text-align:center;min-width:300px;max-width:min(520px,max(260px,calc(100vw - 600px)))}
.mg-obj b{display:block;font-size:14px;letter-spacing:.04em}
.mg-obj small{display:block;margin-top:4px;color:#BBBAC6;font-size:12px;letter-spacing:.06em}
.mg-prog{height:5px;border-radius:99px;background:rgba(255,255,255,.12);margin-top:8px;overflow:hidden}
.mg-prog span{display:block;height:100%;width:0;background:linear-gradient(90deg,#8FA3A8,#B7CECE);border-radius:99px;transition:width .3s}
.mg-map{position:absolute;right:18px;top:18px;padding:10px;width:208px}
.mg-map canvas{display:block;width:186px;height:186px;border-radius:50%}
.mg-map .mg-sp{margin-top:8px;text-align:center;font-size:12px;color:#BBBAC6;letter-spacing:.08em}
.mg-map .mg-sp b{color:#E2E2E2;font-size:15px}
.mg-tgt{position:absolute;right:18px;top:274px;width:208px;padding:10px 14px;display:flex;align-items:center;gap:12px;font-size:12.5px}
.mg-arrow{width:30px;height:30px;flex:0 0 30px}
.mg-tgt b{display:block;font-size:13.5px}.mg-tgt span{color:#BBBAC6}
.mg-inv{position:absolute;left:18px;top:256px;padding:10px 16px;font-size:12.5px;line-height:1.7;width:250px}
.mg-inv b{color:#B7CECE;float:right;font-variant-numeric:tabular-nums}
.mg-bar{position:relative}.mg-bar .mk{position:absolute;top:0;bottom:0;width:3px;margin-left:-1px;background:#fff;box-shadow:0 0 6px rgba(255,255,255,.9);display:none}
.mg-home{margin-top:4px;font-size:11px;color:#BBBAC6;display:none}
.mg-tip{position:absolute;left:50%;top:150px;transform:translateX(-50%);max-width:min(560px,80vw);padding:10px 18px;font-size:14px;line-height:1.5;color:#E2E2E2;text-align:center;opacity:0;transition:opacity .4s;pointer-events:none;border-color:rgba(183,206,206,.45)}
.mg-mapbtn{position:absolute;left:84px;bottom:18px;padding:9px 16px;font-size:12px;font-weight:700;letter-spacing:.14em;color:#E2E2E2;cursor:pointer;border:1px solid rgba(212,219,219,.25);font-family:inherit}
.mg-mapbtn:hover{border-color:#B7CECE}
.mg-mapcard{width:min(1180px,96vw);max-height:calc(100vh - 32px);overflow:auto;padding:20px 22px 16px;border-radius:22px}
.mg-maphead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
.mg-maphead h2{margin:0;font-size:22px;letter-spacing:.12em}.mg-maphead p{margin:4px 0 0;font-size:13px;color:#BBBAC6}
.mg-maphead .mg-btn{width:auto;min-height:40px;margin:0;padding:0 18px;flex:0 0 auto}
.mg-mapwrap{position:relative;width:min(100%,calc((100vh - 290px)*2));aspect-ratio:2/1;margin:0 auto;border-radius:12px;overflow:hidden;background:#1C0F13;box-shadow:inset 0 0 0 1px rgba(212,219,219,.2)}
.mg-mapwrap img{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none;-webkit-user-drag:none}
.mg-mapwrap .gl{position:absolute;background:rgba(28,15,19,.28);pointer-events:none}
.mg-mapwrap .gl.v{top:0;bottom:0;width:1px}.mg-mapwrap .gl.h{left:0;right:0;height:1px}
.mg-mapwrap .gt{position:absolute;font-size:10px;font-weight:700;color:rgba(28,15,19,.75);pointer-events:none}
.mg-mapwrap .side{position:absolute;top:6px;padding:2px 8px;border-radius:6px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1C0F13;background:rgba(226,226,226,.75);pointer-events:none}
.mg-pin{position:absolute;transform:translate(-50%,-50%);border:0;padding:0;background:none;cursor:pointer;font-family:inherit}
.mg-pin .dot{display:block;width:12px;height:12px;border-radius:50%;background:#FFD877;box-shadow:0 0 0 2px #1C0F13,0 0 10px rgba(255,216,119,.9)}
.mg-pin.ap .dot{width:7px;height:7px;background:#E2E2E2;box-shadow:0 0 0 1.5px #1C0F13}
.mg-pin .lb{position:absolute;left:14px;top:50%;transform:translateY(-50%);white-space:nowrap;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:.04em;color:#1C0F13;background:rgba(255,216,119,.92)}
.mg-pin.ap .lb{left:9px;font-size:9.5px;font-weight:700;background:rgba(226,226,226,.85)}
.mg-pin.left .lb{left:auto;right:9px}.mg-pin.up .lb{left:50%;top:auto;bottom:12px;transform:translateX(-50%)}
.mg-pin.here .dot{background:#6EE7A0;box-shadow:0 0 0 2px #1C0F13,0 0 12px rgba(110,231,160,.9)}
.mg-pin.here .lb{background:#6EE7A0}
.mg-pin.here::before{content:"";position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #6EE7A0;animation:mgping 1.6s ease-out infinite}
.mg-pin.sel .dot{transform:scale(1.35)}
@keyframes mgping{from{transform:scale(1);opacity:1}to{transform:scale(4.2);opacity:0}}
.mg-mapinfo{margin:12px auto 0;width:min(100%,calc((100vh - 290px)*2));padding:12px 16px;border-radius:14px;background:rgba(28,15,19,.45);border:1px solid rgba(212,219,219,.14);text-align:left}
.mg-mapinfo b{display:block;font-size:15px;margin-bottom:3px}.mg-mapinfo .co{font-size:12px;color:#BBBAC6;margin-bottom:6px}.mg-mapinfo p{margin:0;font-size:13.5px;line-height:1.55;color:#E2E2E2}
.mg-mapcred{margin-top:10px;font-size:11px;color:#BBBAC6;text-align:center}
.mg-static{position:absolute;inset:0;pointer-events:none;opacity:0;background-color:rgba(255,255,255,.18);background-size:160px 160px;image-rendering:pixelated;mix-blend-mode:screen}
.mg-storm{position:absolute;left:50%;top:98px;transform:translateX(-50%);min-width:min(520px,90vw);max-width:min(680px,94vw);padding:10px 20px;text-align:center;display:none;border-color:rgba(255,90,70,.7);background:linear-gradient(160deg,rgba(120,18,18,.82),rgba(60,8,10,.86))}
.mg-storm b{display:block;font-size:19px;letter-spacing:.1em;color:#FFD2C8}.mg-storm span{display:block;margin-top:4px;font-size:13.5px;color:#FFE9E3}
.mg-storm.hit{animation:mgstorm .8s infinite}.mg-storm.safe{border-color:rgba(110,231,160,.7);background:linear-gradient(160deg,rgba(18,80,60,.82),rgba(8,40,30,.86));animation:none}.mg-storm.safe b{color:#C9FFE3}
@keyframes mgstorm{50%{box-shadow:0 0 34px rgba(255,60,40,.75)}}
.mg-root.storm .mg-view{top:190px}
.mg-env{position:absolute;right:18px;top:344px;width:208px;padding:10px 14px;font-size:12.5px;line-height:1.65}
.mg-env .clk{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}.mg-env .clk b{font-size:17px;letter-spacing:.06em;font-variant-numeric:tabular-nums}.mg-env .clk span{color:#BBBAC6;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase}
.mg-env .tr{display:flex;justify-content:space-between;color:#BBBAC6}.mg-env .tr b{color:#E2E2E2;font-variant-numeric:tabular-nums}
.mg-env .tb{height:6px;border-radius:4px;background:rgba(255,255,255,.12);margin-top:5px;overflow:hidden}.mg-env .tb span{display:block;height:100%;border-radius:4px;transition:width .25s linear}
.mg-svc{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);padding:10px 20px;font-size:14px;font-weight:600;display:none;text-align:center;line-height:1.7}
.mg-svc kbd{display:inline-block;padding:1px 8px;margin:0 2px;border-radius:6px;background:#FFD877;color:#1B1400;font-weight:800}
.mg-prompt{position:absolute;left:50%;bottom:90px;transform:translateX(-50%);padding:12px 22px;font-size:15px;font-weight:600;letter-spacing:.03em;display:none;white-space:nowrap}
.mg-prompt kbd{display:inline-block;padding:1px 8px;margin:0 2px;border-radius:6px;background:#B7CECE;color:#1C0F13;font-weight:800}
.mg-action{position:absolute;left:50%;bottom:150px;transform:translateX(-50%);padding:12px 22px;min-width:280px;text-align:center;display:none}
.mg-action .mg-prog{margin-top:8px;height:6px}
.mg-warn{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);padding:10px 20px;font-size:14px;font-weight:700;color:#FFD877;border-color:rgba(255,216,119,.5);display:none;max-width:min(720px,92vw);text-align:center}
.mg-warn.red{color:#FF9D8A;border-color:rgba(255,120,100,.6)}
.mg-msg{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);padding:9px 18px;font-size:13px;color:#9AF3C2;display:none}
.mg-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 1px rgba(0,0,0,.45);display:none;pointer-events:none}
.mg-view{position:absolute;left:50%;top:104px;transform:translateX(-50%);padding:8px 18px;font-size:13px;font-weight:700;letter-spacing:.08em;color:#E9E9E9;opacity:0;transition:opacity .35s;pointer-events:none}
.mg-pause{position:absolute;left:18px;bottom:18px;padding:9px 16px;font-size:12px;font-weight:700;letter-spacing:.14em;color:#E2E2E2;cursor:pointer;border:1px solid rgba(212,219,219,.25);font-family:inherit}
.mg-pause:hover{border-color:#B7CECE}
.mg-ov{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(24,13,16,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.mg-card{width:min(100%,520px);padding:34px 34px 28px;text-align:center;border-radius:22px;max-height:calc(100vh - 40px);overflow:auto}
.mg-card h2{margin:0 0 12px;font-size:24px;letter-spacing:.1em}
.mg-card p{margin:0 0 16px;font-size:14px;line-height:1.65;color:#D2D3DA}
.mg-card ul{list-style:none;margin:0 0 18px;padding:0;text-align:left}
.mg-card li{padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07);font-size:14px;color:#E2E2E2}
.mg-brief{width:min(100%,640px);padding-bottom:20px}
.mg-btns{position:sticky;bottom:-20px;padding:14px 0 0;background:linear-gradient(rgba(42,34,38,0),rgba(42,34,38,.96) 28%)}
.mg-btns .mg-btn:first-child{margin-top:0}
.mg-sub{margin:0 0 14px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#BBBAC6}
.mg-card ol.mg-steps{list-style:none;counter-reset:st;margin:0 0 14px;padding:0;text-align:left}
.mg-steps li{counter-increment:st;position:relative;padding:8px 12px 8px 46px;margin:0 0 4px;border:0;border-radius:12px;font-size:15px;line-height:1.5;transition:background .25s,color .25s}
.mg-steps li::before{content:counter(st);position:absolute;left:10px;top:9px;width:26px;height:26px;border-radius:50%;background:rgba(183,206,206,.18);color:#B7CECE;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}
.mg-steps li.on{background:rgba(183,206,206,.2);color:#FFFFFF}
.mg-steps li.on::before{background:#B7CECE;color:#1C0F13}
.mg-ctl{margin:0 0 6px;text-align:left;color:#BBBAC6;font-size:13px}.mg-ctl summary{cursor:pointer;letter-spacing:.1em;text-transform:uppercase;padding:6px 2px}
.mg-ctl ul{margin:6px 0 0}.mg-ctl li{font-size:13px;padding:5px 4px}
.mg-btn{display:block;width:100%;min-height:50px;margin:10px 0 0;border-radius:14px;border:1px solid rgba(222,224,224,.25);background:rgba(51,46,51,.65);color:#E2E2E2;font:inherit;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:transform .3s cubic-bezier(.2,.8,.2,1),border-color .2s,background .2s}
.mg-btn:hover{transform:translateY(-2px);border-color:rgba(224,225,225,.6)}
.mg-btn.pri{border-color:transparent;color:#1C0F13;background:linear-gradient(110deg,#E3E3E3,#C7D5D5 55%,#B7CDCE)}
.mg-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#150B0E;font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:#B7CECE}
@media (max-width:900px){.mg-obj{top:auto;bottom:150px;max-width:90vw}.mg-stats{width:200px}.mg-inv{display:none}}
`;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

// ----------------------------------------------------------------- the game
let G = null; // running instance

function start(opts) {
  if (G) stop();
  G = createGame(opts);
}
function stop() {
  if (!G) return;
  G.destroy(); G = null;
}

function createGame(opts) {
  const container = opts.container;
  let lang = opts.lang || 'en';
  const tr = (k, v) => { let s = T[lang][k]; if (v) for (const key in v) s = s.replace('{' + key + '}', v[key]); return s; };
  let destroyed = false, raf = 0;
  SHADOW.on = opts.mission === 'shadow';
  const MISSION = SHADOW.on;
  SHELTER.on = opts.mission === 'storm';
  const STORM = SHELTER.on;
  MIR_SPOTS.forEach(m => { m.placed = false; });

  // ---------- DOM
  container.innerHTML = '';
  const style = el('style'); style.textContent = CSS; container.appendChild(style);
  const root = el('div', 'mg-root' + (opts.mission === 'storm' ? ' storm' : '')); container.appendChild(root);
  const canvas = el('canvas', 'mg-canvas'); root.appendChild(canvas);
  const stat = el('div', 'mg-static'); root.appendChild(stat);
  const vig = el('div', 'mg-vig'), hurt = el('div', 'mg-hurt'); root.append(vig, hurt);
  const stormEl = el('div', 'mg-storm mg-glass', '<b></b><span></span>'); root.appendChild(stormEl);
  const stormB = stormEl.querySelector('b'), stormS = stormEl.querySelector('span');
  { const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d'), im = g.createImageData(160, 160);
    for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() < 0.5 ? 255 : Math.random() * 120; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = Math.random() < 0.55 ? 255 : 0; }
    g.putImageData(im, 0, 0); stat.style.backgroundImage = 'url(' + c.toDataURL() + ')'; }
  const stats = el('div', 'mg-stats mg-glass'); root.appendChild(stats);
  const BARS = [['health', '#6EE7A0'], ['oxygen', '#B7CECE'], ['tank', '#8EC5D6'], ['energy', '#FFB54D'], ['rover', '#BBBAC6'], ['radiation', '#FF6F6F']];
  const bar = {};
  BARS.forEach(([k, c]) => {
    const r = el('div', 'mg-row'); r.style.setProperty('--c', c);
    r.innerHTML = '<div class="mg-rh"><span class="n"></span><span class="mg-rv v"></span></div><div class="mg-bar"><span></span></div>';
    stats.appendChild(r); bar[k] = { row: r, n: r.querySelector('.n'), v: r.querySelector('.v'), f: r.querySelector('.mg-bar span') };
  });
  bar.oxygen.f.parentNode.insertAdjacentHTML('beforeend', '<i class="mk"></i>'); bar.oxygen.mk = bar.oxygen.row.querySelector('.mk');
  bar.oxygen.row.insertAdjacentHTML('beforeend', '<div class="mg-home"></div>'); bar.oxygen.home = bar.oxygen.row.querySelector('.mg-home');
  if (MISSION || STORM) bar.tank.row.style.display = 'none';
  const inv = el('div', 'mg-inv mg-glass'); root.appendChild(inv);
  const tipEl = el('div', 'mg-tip mg-glass'); root.appendChild(tipEl);
  const env = el('div', 'mg-env mg-glass', '<div class="clk"><b></b><span></span></div><div class="tr"><span class="a"></span><b class="av"></b></div><div class="tr"><span class="u"></span><b class="uv"></b></div><div class="tb"><span></span></div>'); root.appendChild(env);
  const envClk = env.querySelector('.clk b'), envPh = env.querySelector('.clk span'), envAn = env.querySelector('.a'), envAv = env.querySelector('.av'), envUn = env.querySelector('.u'), envUv = env.querySelector('.uv'), envBar = env.querySelector('.tb span');
  const dcache = new WeakMap();   // only touch the DOM when a value really changed
  function dset(node, prop, val) {
    let o = dcache.get(node); if (!o) { o = {}; dcache.set(node, o); }
    if (o[prop] === val) return; o[prop] = val;
    if (prop === 'text') node.textContent = val; else if (prop === 'html') node.innerHTML = val; else node.style[prop] = val;
  }
  const obj = el('div', 'mg-obj mg-glass', '<b></b><small></small><div class="mg-prog"><span></span></div>'); root.appendChild(obj);
  const objB = obj.querySelector('b'), objS = obj.querySelector('small'), objP = obj.querySelector('.mg-prog span');
  const map = el('div', 'mg-map mg-glass', '<canvas width="372" height="372"></canvas><div class="mg-sp"><b>0</b> <span></span></div>'); root.appendChild(map);
  const mapC = map.querySelector('canvas'), mctx = mapC.getContext('2d'), spB = map.querySelector('b'), spU = map.querySelector('.mg-sp span');
  const tgt = el('div', 'mg-tgt mg-glass',
    '<svg class="mg-arrow" viewBox="0 0 30 30"><path d="M15 3 L24 25 L15 20 L6 25 Z" fill="#B7CECE"/></svg><div><b></b><span></span></div>');
  root.appendChild(tgt);
  const arrow = tgt.querySelector('.mg-arrow'), tgtB = tgt.querySelector('b'), tgtS = tgt.querySelector('span');
  const prompt = el('div', 'mg-prompt mg-glass'); root.appendChild(prompt);
  const svc = el('div', 'mg-svc mg-glass'); root.appendChild(svc);
  const action = el('div', 'mg-action mg-glass', '<div class="t"></div><div class="mg-prog"><span></span></div>'); root.appendChild(action);
  const actT = action.querySelector('.t'), actP = action.querySelector('.mg-prog span');
  const warn = el('div', 'mg-warn mg-glass'); root.appendChild(warn);
  const msg = el('div', 'mg-msg mg-glass'); root.appendChild(msg);
  const cross = el('div', 'mg-cross'); root.appendChild(cross);
  const viewTag = el('div', 'mg-view mg-glass'); root.appendChild(viewTag);
  const pauseBtn = el('button', 'mg-pause mg-glass', 'II'); pauseBtn.type = 'button'; root.appendChild(pauseBtn);
  const mapBtn = el('button', 'mg-mapbtn mg-glass', ''); mapBtn.type = 'button'; root.appendChild(mapBtn);
  const ovMap = el('div', 'mg-ov');
  const ovHelp = el('div', 'mg-ov'), ovPause = el('div', 'mg-ov'), ovEnd = el('div', 'mg-ov');
  root.append(ovMap, ovHelp, ovPause, ovEnd);
  const load = el('div', 'mg-load', ''); root.appendChild(load);

  // ---------- read-aloud narration (browser speech synthesis)
  const synth = window.speechSynthesis || null;
  let voices = [], spkTok = 0, voiceVol = opts.volume == null ? 0.7 : opts.volume, speaking = false;
  const loadVoices = () => { try { voices = synth.getVoices(); } catch (e) { voices = []; } };
  if (synth) { loadVoices(); try { synth.addEventListener('voiceschanged', loadVoices); } catch (e) { /* ignore */ } }
  const VOICE_PREF = { en: ['en'], uz: ['uz', 'tr', 'ru'], ru: ['ru'] }, VOICE_TAG = { en: 'en-US', uz: 'uz-UZ', ru: 'ru-RU' };
  function pickVoice() {
    for (const p of VOICE_PREF[lang]) { const v = voices.find(x => (x.lang || '').toLowerCase().replace('_', '-').startsWith(p)); if (v) return v; }
    return null;
  }
  function setReadBtn() { const b = ovHelp.querySelector('#rd'); if (b) b.textContent = speaking ? tr('stopRead') : tr('readAloud'); }
  function stopSpeech() {
    spkTok++; speaking = false;
    if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
    ovHelp.querySelectorAll('.mg-steps li.on').forEach(li => li.classList.remove('on')); setReadBtn();
  }
  function speakLines(lines, onLine) {
    if (!synth || voiceVol <= 0.001) return;
    stopSpeech(); const tok = spkTok; speaking = true; setReadBtn();
    const say = i => {
      if (tok !== spkTok) return;
      if (i >= lines.length) { speaking = false; setReadBtn(); if (onLine) onLine(-1); return; }
      const u = new SpeechSynthesisUtterance(String(lines[i]).replace(/<[^>]+>/g, ''));
      const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = VOICE_TAG[lang];
      u.rate = 0.92; u.pitch = 1.05; u.volume = clamp(voiceVol * 1.3, 0, 1);
      u.onstart = () => { if (tok === spkTok && onLine) onLine(i); };
      u.onend = () => say(i + 1);
      u.onerror = () => { if (tok === spkTok) say(i + 1); };
      synth.speak(u);
    };
    setTimeout(() => say(0), 80);
  }
  function startBriefing() {
    const items = ovHelp.querySelectorAll('.mg-steps li');
    speakLines([tr(BK()[0])].concat(T[lang][BK()[1]]), i => {
      items.forEach((li, k) => li.classList.toggle('on', k === i - 1));
      if (i >= 1 && items[i - 1]) items[i - 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function BK() { return STORM ? ['kidTitleS', 'kidStorm'] : MISSION ? ['kidTitleM', 'kidShadow'] : ['kidTitle', 'kidMoon']; }
  function applyDom() {
    BARS.forEach(([k]) => { bar[k].n.textContent = tr(k); });
    pauseBtn.title = tr('paused');
    ovHelp.innerHTML = '<div class="mg-card mg-glass mg-brief"><h2>' + tr('helpTitle') + '</h2><div class="mg-sub">' + tr(BK()[0]) + '</div><ol class="mg-steps">' +
      T[lang][BK()[1]].map(h => '<li>' + h + '</li>').join('') + '</ol><details class="mg-ctl"><summary>' + tr('controls') + '</summary><ul>' +
      T[lang].help.map(h => '<li>' + h + '</li>').join('') + '</ul></details><div class="mg-btns"><button class="mg-btn" id="rd" type="button"></button><button class="mg-btn pri" id="go" type="button">' + tr('begin') + '</button></div></div>';
    ovHelp.querySelector('#go').onclick = () => { stopSpeech(); ovHelp.style.display = 'none'; sfx.resume(); S.paused = false; };
    ovHelp.querySelector('#rd').onclick = () => { if (speaking) stopSpeech(); else startBriefing(); };
    setReadBtn();
    ovPause.innerHTML = '<div class="mg-card mg-glass"><h2>' + tr('paused') + '</h2><button class="mg-btn pri" id="r" type="button">' + tr('resume') +
      '</button><button class="mg-btn" id="q" type="button">' + tr('quit') + '</button></div>';
    ovPause.querySelector('#r').onclick = () => setPause(false);
    ovPause.querySelector('#q').onclick = exit;
    load.textContent = tr('loading');
    mapBtn.textContent = '🗺 ' + tr('map_btn'); mapBtn.title = tr('help_map');
    buildMap();
  }
  // ---------- real Moon map
  const MAP_URL = opts.mapUrl || window.MOON_MAP_URL || '';
  let mapOpen = false, mapWasPaused = false, mapSel = null;
  const fmtLat = v => Math.abs(v).toFixed(1) + '° ' + (v >= 0 ? 'N' : 'S'), fmtLon = v => Math.abs(v).toFixed(1) + '° ' + (v >= 0 ? 'E' : 'W');
  const mapPos = (lat, lon) => ({ x: (lon + 180) / 360 * 100, y: clamp((90 - lat) / 180 * 100, 3, 97) });
  function hereKey() { return STORM ? 'site3' : MISSION ? 'site2' : 'site1'; }
  function siteInfo(si) {
    if (si.apollo) return { name: 'Apollo ' + si.apollo, co: fmtLat(si.lat) + ', ' + fmtLon(si.lon), text: tr('apollo_info', { n: si.apollo, y: si.y }) };
    return { name: tr(si.key + '_name') + ' · ' + tr('map_lvl', { n: si.level }), co: fmtLat(si.lat) + ', ' + fmtLon(si.lon), text: tr(si.key + '_info') };
  }
  function buildMap() {
    let grid = '';
    for (let lon = -150; lon <= 150; lon += 30) { const x = (lon + 180) / 360 * 100; grid += '<i class="gl v" style="left:' + x + '%"></i><span class="gt" style="left:calc(' + x + '% + 3px);bottom:3px">' + Math.abs(lon) + '°' + (lon > 0 ? 'E' : lon < 0 ? 'W' : '') + '</span>'; }
    for (let lat = -60; lat <= 60; lat += 30) { const y = (90 - lat) / 180 * 100; grid += '<i class="gl h" style="top:' + y + '%"></i><span class="gt" style="left:4px;top:calc(' + y + '% + 2px)">' + Math.abs(lat) + '°' + (lat > 0 ? 'N' : lat < 0 ? 'S' : '') + '</span>'; }
    const pins = MAP_SITES.map((si, i) => {
      const p = mapPos(si.lat, si.lon), here = si.key === hereKey();
      const label = si.apollo ? 'Apollo ' + si.apollo : (here ? tr('map_here') + ' · ' : '') + tr('map_lvl', { n: si.level });
      return '<button type="button" class="mg-pin' + (si.apollo ? ' ap' : '') + (here ? ' here' : '') + (si.lb ? ' ' + si.lb : '') + '" data-i="' + i + '" style="left:' + p.x + '%;top:' + p.y + '%"><span class="dot"></span><span class="lb">' + label + '</span></button>';
    }).join('');
    ovMap.innerHTML = '<div class="mg-mapcard mg-glass"><div class="mg-maphead"><div><h2>' + tr('map_title') + '</h2><p>' + tr('map_sub') + ' · ' + tr('map_hint') + '</p></div><button class="mg-btn" type="button" id="mx">' + tr('map_close') + '</button></div>' +
      '<div class="mg-mapwrap">' + (MAP_URL ? '<img alt="" src="' + MAP_URL + '">' : '') + grid +
      '<span class="side" style="left:calc(25% + 6px)">' + tr('map_near') + '</span><span class="side" style="left:4px">' + tr('map_far') + '</span><span class="side" style="right:4px">' + tr('map_far') + '</span>' + pins + '</div>' +
      '<div class="mg-mapinfo"><b></b><div class="co"></div><p></p></div><div class="mg-mapcred">' + tr('map_credit') + '</div></div>';
    ovMap.querySelector('#mx').onclick = () => toggleMap(false);
    ovMap.querySelectorAll('.mg-pin').forEach(b => { b.onclick = () => selectSite(+b.dataset.i); });
    selectSite(mapSel == null ? MAP_SITES.findIndex(si => si.key === hereKey()) : mapSel);
  }
  function selectSite(i) {
    mapSel = i; const inf = siteInfo(MAP_SITES[i]);
    ovMap.querySelector('.mg-mapinfo b').textContent = inf.name; ovMap.querySelector('.mg-mapinfo .co').textContent = inf.co; ovMap.querySelector('.mg-mapinfo p').textContent = inf.text;
    ovMap.querySelectorAll('.mg-pin').forEach(b => b.classList.toggle('sel', +b.dataset.i === i));
  }
  function toggleMap(on) {
    if (on == null) on = !mapOpen;
    if (on === mapOpen) return;
    if (on && (S.over || ovHelp.style.display === 'flex' || ovPause.style.display === 'flex')) return;
    mapOpen = on; ovMap.style.display = on ? 'flex' : 'none';
    if (on) { mapWasPaused = S.paused; S.paused = true; for (const k in keys) keys[k] = false; selectSite(MAP_SITES.findIndex(si => si.key === hereKey())); }
    else if (!mapWasPaused) S.paused = false;
  }

  // ---------- three.js
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const PR_MAX = Math.min(2, Math.max(1.25, window.devicePixelRatio || 1)), PR_MIN = 1; let pr = PR_MAX;   // high resolution: full Retina sharpness, never below 1:1
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x03050a, 650, 1650);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 9000);

  const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sunLight.castShadow = true; sunLight.shadow.mapSize.set(2048, 2048);
  const sc = sunLight.shadow.camera; sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 420;
  sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.35;
  scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0x5a7ab8, 0x2a2a30, 1.0); scene.add(hemi);
  const ambL = new THREE.AmbientLight(0x303a50, 0.7); scene.add(ambL);
  const fill = new THREE.DirectionalLight(0x9db8ff, 0.9); fill.position.set(-0.55, 0.37, -0.72).multiplyScalar(100); scene.add(fill);   // earthshine
  const sunDir = SUN.clone(); let sunSin = SUN.y;

  initMaterials();
  const detailTex = makeDetailTexture(); detailTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex, bumpMap: detailTex, bumpScale: 2.2, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.78 + 0.44 * hash(Math.round(p.getX(i) * 50), Math.round(p.getY(i) * 50), Math.round(p.getZ(i) * 50) + 13); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); } rockGeo.computeVertexNormals(); }

  // sky
  const starGeo = new THREE.BufferGeometry(), sp = new Float32Array(2600 * 3);
  for (let i = 0; i < 2600; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    sp[i * 3] = Math.cos(a) * r * 6000; sp[i * 3 + 1] = Math.abs(u) * 6000; sp[i * 3 + 2] = Math.sin(a) * r * 6000;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false }));
  stars.frustumCulled = false; scene.add(stars);
  const earthTex = makeEarthTexture();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(330, 36, 22), new THREE.MeshBasicMaterial({ map: earthTex, fog: false }));
  earth.position.set(-3300, 2200, -4300); scene.add(earth);
  const cloudTex = makeCloudTexture();
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(337, 36, 22), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
  clouds.position.copy(earth.position); scene.add(clouds);
  const earthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(110,170,255,.55)', 'rgba(80,140,255,.22)'), blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
  earthGlow.scale.set(960, 960, 1); earthGlow.position.copy(earth.position); scene.add(earthGlow);
  const sunTex = makeGlowTexture('rgba(255,255,240,1)', 'rgba(255,236,190,.35)');
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
  sunSpr.scale.set(1100, 1100, 1); sunSpr.position.copy(SUN).multiplyScalar(5600); scene.add(sunSpr);
  const discTex = makeDiscTexture();
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, fog: false, depthWrite: false, toneMapped: false }));
  sunDisc.scale.set(230, 230, 1); scene.add(sunDisc);

  // lab + rover + astronaut
  const lab = makeLab(); scene.add(lab.group);
  const rover = makeRover(); scene.add(rover.root);
  const astro = makeAstronaut(); scene.add(astro.root);
  const haloTex = makeGlowTexture('rgba(120,240,255,.9)', 'rgba(60,200,240,.25)');

  // sample sites
  const rocks = [];
  (MISSION || STORM ? [] : SITES).forEach(s => {
    s.left = 4; s.beam = null;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 420, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x55dfff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    beam.position.set(s.x, heightAt(s.x, s.z) + 200, s.z); scene.add(beam); s.beam = beam;
    for (let i = 0; i < 4; i++) {
      const a = hash(s.id, i, 41) * Math.PI * 2, r = s.R * (0.18 + hash(s.id, i, 42) * 0.4);
      const x = s.x + Math.sin(a) * r, z = s.z + Math.cos(a) * r, y = heightAt(x, z);
      const m = mesh(new THREE.DodecahedronGeometry(0.5 + hash(s.id, i, 43) * 0.3, 0), M.sample, x, y + 0.3, z);
      m.rotation.set(i, i * 1.7, i * 2.3);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      halo.scale.set(7, 7, 1); halo.position.set(x, y + 1.0, z);
      scene.add(m, halo);
      rocks.push({ site: s, x, z, y, mesh: m, halo, taken: false });
    }
  });

  // ---------- terrain streaming
  const chunks = new Map();
  let queue = [];
  function chunkKey(cx, cz) { return cx + ',' + cz; }
  // deterministic stone layout per chunk (used both for drawing and for rover collisions)
  const rockCache = new Map();
  function chunkRocks(cx, cz) {
    const key = chunkKey(cx, cz); let a = rockCache.get(key); if (a) return a;
    a = [];
    for (let k = 0; k < 34; k++) {
      const lx = hash(cx * 97 + k, cz, 51) * CS, lz = hash(cx * 97 + k, cz, 52) * CS, wx = cx * CS + lx, wz = cz * CS + lz;
      if (Math.hypot(wx, wz) < 70) continue;
      const big = hash(cx * 97 + k, cz, 53), sc = big > 0.93 ? 1.8 + big * 2 : 0.25 + big * 0.9;
      const sx = sc * (0.8 + hash(k, cx, 57)), sz = sc * (0.8 + hash(k, cz, 58));
      a.push({ lx, lz, wx, wz, y: heightAt(wx, wz) + sc * 0.15, s: sc, sx, sy: sc * 0.8, sz,
        rx: hash(k, cx, 54) * 6, ry: hash(k, cz, 55) * 6, rz: hash(cz, k, 56) * 6, r: 0.75 * (sx + sz) / 2, top: sc * 0.77 });
    }
    rockCache.set(key, a); return a;
  }
  function* makeChunk(cx, cz, lod) {
    const geo = yield* buildTerrainGeometry(cx, cz, lod === 0 ? 64 : 16);
    yield;
    const m = new THREE.Mesh(geo, terrainMat);
    m.position.set(cx * CS, 0, cz * CS); m.receiveShadow = true; m.castShadow = lod === 0;
    let rocksMesh = null;
    if (lod === 0) {
      const cnt = 34; rocksMesh = new THREE.InstancedMesh(rockGeo, M.rock, cnt);
      const o = new THREE.Object3D(); let used = 0;
      for (const r of chunkRocks(cx, cz)) {
        o.position.set(r.lx, r.y, r.lz); o.rotation.set(r.rx, r.ry, r.rz); o.scale.set(r.sx, r.sy, r.sz);
        o.updateMatrix(); rocksMesh.setMatrixAt(used++, o.matrix);
      }
      rocksMesh.count = used; rocksMesh.castShadow = true; rocksMesh.receiveShadow = true; rocksMesh.frustumCulled = false;
      m.add(rocksMesh);
    }
    scene.add(m);
    return { mesh: m, lod, rocks: rocksMesh };
  }
  function removeChunk(c) {
    scene.remove(c.mesh); c.mesh.geometry.dispose(); if (c.rocks) c.rocks.dispose();
  }
  let job = null;                    // chunk being built, a few milliseconds per frame
  function planChunks(px, pz, immediate) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const want = new Map();
    for (let dz = -RING; dz <= RING; dz++) for (let dx = -RING; dx <= RING; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dz)); if (ring > RING) continue;
      want.set(chunkKey(pcx + dx, pcz + dz), { cx: pcx + dx, cz: pcz + dz, lod: ring <= NEAR ? 0 : 1, d: dx * dx + dz * dz });
    }
    for (const [k, c] of chunks) if (!want.has(k)) { removeChunk(c); chunks.delete(k); }
    for (const k of rockCache.keys()) if (!want.has(k)) rockCache.delete(k);
    if (job) { const w = want.get(job.k); if (!w || w.lod !== job.w.lod) job = null; }
    queue = [];
    for (const [k, w] of want) { const c = chunks.get(k); if ((!c || c.lod !== w.lod) && !(job && job.k === k)) queue.push({ k, w }); }
    queue.sort((a, b) => a.w.d - b.w.d);
    if (immediate) processQueue(1e9);
  }
  const qStat = { max: 0, calls: 0, built: 0 };
  function processQueue(budgetMs) {
    const t0 = performance.now(); qStat.calls++;
    while (performance.now() - t0 < budgetMs) {
      if (!job) { const q = queue.shift(); if (!q) break; job = { k: q.k, w: q.w, gen: makeChunk(q.w.cx, q.w.cz, q.w.lod) }; }
      const r = job.gen.next();
      const dtq = performance.now() - t0; if (budgetMs < 100 && dtq > qStat.max) qStat.max = dtq;
      if (r.done) { qStat.built++; const old = chunks.get(job.k); if (old) removeChunk(old); chunks.set(job.k, r.value); job = null; }
    }
  }

  // ---------- state
  const sfx = new Sfx(); sfx.setVolume(opts.volume == null ? 0.7 : opts.volume);

  // ---------- dust puffs (jump / landing)
  const dustGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const dust = [];
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ color: 0xb9aca2, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    m.visible = false; scene.add(m); dust.push({ m, t: 0, life: 1, vx: 0, vy: 0, vz: 0, s: 1 });
  }
  let dustI = 0;
  function puff(x, y, z, n, power, color, rise) {
    for (let i = 0; i < n; i++) {
      const d = dust[dustI++ % dust.length], a = Math.random() * Math.PI * 2, sp = (0.5 + Math.random()) * power;
      d.t = 0; d.life = 0.7 + Math.random() * 0.5; d.s = 0.35 + Math.random() * 0.4; d.m.material.color.setHex(color || 0xb9aca2);
      d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = (rise || 0) + 0.4 + Math.random() * 0.9 * power * 0.4;
      d.m.position.set(x + Math.cos(a) * 0.4, y + 0.1, z + Math.sin(a) * 0.4); d.m.visible = true;
    }
  }
  function updateDust(dt) {
    for (const d of dust) {
      if (!d.m.visible) continue;
      d.t += dt; const k = d.t / d.life;
      if (k >= 1) { d.m.visible = false; continue; }
      d.m.position.x += d.vx * dt; d.m.position.z += d.vz * dt; d.m.position.y += d.vy * dt; d.vy -= 1.2 * dt; d.vx *= 0.97; d.vz *= 0.97;
      d.m.scale.setScalar(d.s * (1 + k * 2.2)); d.m.material.opacity = 0.5 * (1 - k) * (1 - k);
    }
  }
  const S = {
    paused: true, over: false, t: 0, mode: 'foot',
    foot: { x: DOOR.x, z: DOOR.z + 5, yaw: 0, speed: 0, phase: 0, y: 0, h: 0, vh: 0, air: false, landT: 0 },
    car: { x: 24, z: 40, yaw: 0.5, v: 0, steer: 0, y: 0, pitch: 0, roll: 0, h: 0, vh: 0, air: false },
    hp: 100, o2: 100, en: 100, rv: 100, money: START_MONEY, svc: { heal: false, repair: false }, svcT: 0, hitT: 0, hitUntil: 0, lastDmg: 0, shake: 0, smokeT: 0, rad: 0, carried: 0, cargo: 0, delivered: 0,
    action: null, flare: { next: 1e9,   /* random solar flares removed: the Solar Radiation Storm mission teaches this now */ warn: false, on: false, t: 0 }, shade: false, shadeT: 0, hurtT: 0,
    view: 'third', viewUntil: 0, inBase: false, autoFP: false,
    cam: { yaw: 0, yawOff: 0, pitchOff: 0, fpPitch: 0, zoom: 1, idle: 0, x: 0, y: 3, z: -8 },
    lastBeepO2: 0, lastRefill: false, doorOpen: 0, toast: 0,
    mission: MISSION, clock: CLOCK_START, amb: 40, suit: 22, sunlit: true, tempT: 0, sunU: { x: SUN.x, z: SUN.z }, tanE: 0.4,
    storm: { on: STORM, phase: 'calm', t: 4, timer: STORM_WARN, valves: [0, 0], pumping: -1, shielded: false, exposed: false, shieldT: 0, clickT: 0 },
    tankOn: !MISSION && !STORM, tank: MISSION || STORM ? 100 : TANK_START, makerQ: 0, refilling: false, o2Rate: 0, o2Line: 0, homeViaRover: false, respawnT: 0,
    mirrors: { pack: 3, placed: 0 }, tower: { prog: 0, fixed: false, fixT: 0 }, winAt: 0, sparkT: 0
  };
  S.car.y = heightAt(S.car.x, S.car.z);
  if (STORM) { S.foot.x = 38; S.foot.z = 172; S.foot.yaw = Math.atan2(-38, 19 - 172); }
  const keys = {};
  const subject = () => (S.mode === 'car' ? S.car : S.foot);

  // ---------- mission "The Deadly Shadow": broken tower, giant mirrors, pool of reflected light
  const mis = { tower: null, spots: [], pool: null, light: null, beacon: null, mats: [] };
  function buildMission() {
    const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); mis.mats.push(m); return m; };
    const steel = mat({ color: 0xb9c1cc, metalness: 0.75, roughness: 0.35 });
    const white = mat({ color: 0xe9edf2, roughness: 0.55, metalness: 0.15 });
    const lampM = mat({ color: 0x331111, emissive: 0xff3322, emissiveIntensity: 2, roughness: 0.4 });
    const chrome = mat({ color: 0xe4ecf7, metalness: 1, roughness: 0.06, emissive: 0x6a5530, emissiveIntensity: 0.55 });
    const frameM = mat({ color: 0x2a2f38, metalness: 0.6, roughness: 0.5 });
    const ghostM = new THREE.MeshBasicMaterial({ color: 0x55dfff, transparent: true, opacity: 0.3, depthWrite: false }); mis.mats.push(ghostM);
    const addBeam = (r1, r2, len, color, op) => { const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); mis.mats.push(m); return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 12, 1, true), m); };
    // the tower
    const ty = heightAt(TOWER.x, TOWER.z);
    const g = new THREE.Group(); g.position.set(TOWER.x, ty, TOWER.z);
    g.add(mesh(new THREE.BoxGeometry(5.5, 0.9, 5.5), white, 0, 0.45, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.55, 11, 10), steel, 0, 6.4, 0));
    for (let i = 0; i < 4; i++) { const t = mesh(new THREE.TorusGeometry(0.66 - i * 0.08, 0.07, 6, 14), steel, 0, 2.2 + i * 2.5, 0); t.rotation.x = Math.PI / 2; g.add(t); }
    g.add(mesh(new THREE.BoxGeometry(2.0, 1.6, 1.6), white, 2.4, 1.7, 0));
    const panel = mesh(new THREE.BoxGeometry(2.6, 0.1, 1.6), M.solar, -2.5, 1.7, 0); panel.rotation.z = 0.5; g.add(panel);
    const top = new THREE.Group(); top.position.set(0, 11.9, 0); g.add(top);
    const dish = mesh(new THREE.SphereGeometry(2.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 1.0, 0); dish.rotation.x = -0.9; dish.material = white.clone(); dish.material.side = THREE.DoubleSide; mis.mats.push(dish.material); top.add(dish);
    top.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 6), steel, 0, 2.1, 0));
    const lamp = mesh(new THREE.SphereGeometry(0.3, 10, 8), lampM, 0, 4.3, 0, false); top.add(lamp);
    const up = addBeam(1.3, 1.3, 300, 0x66ffb0, 0.22); up.position.set(0, 160, 0); up.visible = false; g.add(up);
    scene.add(g);
    mis.tower = { g, top, lamp, lampM, up, base: ty };
    const beacon = addBeam(2.4, 2.4, 420, 0xff6a4d, 0.16); beacon.position.set(TOWER.x, ty + 200, TOWER.z); scene.add(beacon); mis.beacon = beacon;
    // the three mirror spots on the sunny rim
    const sd = new THREE.Vector3(SH_U.x * Math.cos(SH_E), Math.sin(SH_E), SH_U.z * Math.cos(SH_E));
    const target = new THREE.Vector3(TOWER.x, ty + 5, TOWER.z), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
    MIR_SPOTS.forEach(m => {
      const gy = heightAt(m.x, m.z), P0 = new THREE.Vector3(m.x, gy + 3.6, m.z);
      const toT = target.clone().sub(P0), L = toT.length(); toT.normalize();
      const n = sd.clone().add(toT).normalize();                       // mirror normal = bisector of sun and tower directions
      const qn = new THREE.Quaternion().setFromUnitVectors(Z, n);
      const real = new THREE.Group(); real.position.set(m.x, gy, m.z);
      real.add(mesh(new THREE.CylinderGeometry(0.16, 0.26, 3.6, 8), steel, 0, 1.8, 0));
      const pr_ = new THREE.Group(); pr_.position.y = 3.6; pr_.quaternion.copy(qn); real.add(pr_);
      pr_.add(mesh(new THREE.BoxGeometry(7.4, 5.4, 0.22), frameM, 0, 0, -0.02));
      pr_.add(mesh(new THREE.BoxGeometry(7.0, 5.0, 0.12), chrome, 0, 0, 0.1));
      real.visible = false; scene.add(real);
      const ghost = new THREE.Group(); ghost.position.set(m.x, gy, m.z);
      const gp = new THREE.Mesh(new THREE.BoxGeometry(7.0, 5.0, 0.12), ghostM); gp.position.y = 3.6; gp.quaternion.copy(qn); ghost.add(gp);
      const gs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 3.6, 8), ghostM); gs.position.y = 1.8; ghost.add(gs);
      scene.add(ghost);
      const pole = addBeam(1.4, 1.4, 170, 0xffd877, 0.2); pole.position.set(m.x, gy + 85, m.z); scene.add(pole);
      const beam = addBeam(3.4, 1.3, L, 0xffe9b0, 0.085); beam.position.copy(P0).add(target).multiplyScalar(0.5); beam.quaternion.setFromUnitVectors(Y, toT); beam.visible = false; scene.add(beam);
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xfff0c0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      glint.scale.set(18, 18, 1); glint.position.copy(P0); glint.visible = false; scene.add(glint);
      mis.spots.push({ real, ghost, pole, beam, glint });
    });
    // pool of reflected light on the crater floor
    {
      const rings = 9, segs = 44, pos = [], col = [], idx = [];
      pos.push(TOWER.x, ty + 0.5, TOWER.z); col.push(0.9, 0.74, 0.45);
      for (let r = 1; r <= rings; r++) for (let k = 0; k < segs; k++) {
        const rr = r / rings * POOL_R, a = k / segs * Math.PI * 2, x = TOWER.x + Math.cos(a) * rr, z = TOWER.z + Math.sin(a) * rr, f = Math.pow(1 - r / rings, 1.4);
        pos.push(x, heightAt(x, z) + 0.5, z); col.push(0.9 * f, 0.74 * f, 0.45 * f);
      }
      for (let k = 0; k < segs; k++) idx.push(0, 1 + k, 1 + (k + 1) % segs);
      for (let r = 1; r < rings; r++) for (let k = 0; k < segs; k++) {
        const a = 1 + (r - 1) * segs + k, b = 1 + (r - 1) * segs + (k + 1) % segs, c = a + segs, d = b + segs; idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
      const pm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
      mis.mats.push(pm); mis.pool = new THREE.Mesh(geo, pm); mis.pool.visible = false; mis.pool.frustumCulled = false; scene.add(mis.pool);
    }
    mis.light = new THREE.PointLight(0xffd9a0, 0, 46, 2); mis.light.position.set(TOWER.x, ty + 9, TOWER.z); scene.add(mis.light);
  }
  function updateMission(dt) {
    if (!S.mission || !mis.tower) return;
    const T = mis.tower, n = S.mirrors.placed;
    mis.spots.forEach((sp, i) => {
      const pl = MIR_SPOTS[i].placed;
      sp.real.visible = pl; sp.beam.visible = pl; sp.glint.visible = pl;
      sp.ghost.visible = sp.pole.visible = !pl && S.mirrors.pack > 0;
    });
    mis.pool.visible = n > 0; mis.pool.material.opacity = 0.16 + 0.09 * n; mis.light.intensity = n * 110;
    if (S.tower.fixed) S.tower.fixT += dt;
    const fix = S.tower.fixed ? smooth(0, 1, S.tower.fixT / 1.6) : 0;
    T.top.rotation.z = lerp(0.7, 0, fix); T.top.position.x = lerp(0.6, 0, fix);
    T.lampM.emissive.set(S.tower.fixed ? 0x33ff88 : 0xff3322);
    T.lampM.emissiveIntensity = S.tower.fixed ? 2.2 : (Math.sin(S.t * 9) > 0 ? 2.5 : 0.15);
    T.up.visible = S.tower.fixed; T.up.material.opacity = 0.2 + 0.08 * Math.sin(S.t * 4);
    mis.beacon.material.color.set(S.tower.fixed ? 0x55ff9a : 0xff6a4d);
    if (!S.tower.fixed) { S.sparkT -= dt; if (S.sparkT <= 0) { S.sparkT = 0.5 + Math.random() * 0.7; puff(TOWER.x + 0.7, T.base + 12.4, TOWER.z, 2, 0.5, 0xffb347, 0.8); } }
  }
  if (MISSION) buildMission();
  // ---------- mission "Solar Radiation Storm": storm shelter with hollow water walls
  const shel = { water: [], wheels: [], mats: [] };
  function buildShelter() {
    lab.table.visible = false;
    const mat = o => { const m = new THREE.MeshStandardMaterial(o); shel.mats.push(m); return m; };
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe6ee, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }); shel.mats.push(glass);
    const frame = mat({ color: 0x4a4f58, roughness: 0.6, metalness: 0.5 });
    const red = mat({ color: 0xd8342a, roughness: 0.45, metalness: 0.3 });
    const H = 2.6, gap = Math.asin(SHELTER.door / ((SHELTER.rIn + SHELTER.rOut) / 2)) + 0.04;
    const g = new THREE.Group(); scene.add(g);
    // two hollow half-walls (A: +x side, B: −x side), the doorway faces the airlock (+z)
    [[gap, Math.PI - gap], [Math.PI, Math.PI - gap]].forEach(([t0, len], i) => {
      [SHELTER.rOut, SHELTER.rIn].forEach(r => g.add(mesh(new THREE.CylinderGeometry(r, r, H, 40, 1, true, t0, len), glass, 0, H / 2 + 0.05, 0, false)));
      const wgeo = new THREE.CylinderGeometry((SHELTER.rIn + SHELTER.rOut) / 2, (SHELTER.rIn + SHELTER.rOut) / 2, 1, 40, 1, true, t0, len); wgeo.translate(0, 0.5, 0);
      const wm = new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }); shel.mats.push(wm);
      const water = new THREE.Mesh(wgeo, wm); water.position.y = 0.06; water.scale.y = 0.001; g.add(water); shel.water.push(water);
    });
    // frame: rings at top and bottom, posts at the doorway, roof
    [0.06, H + 0.05].forEach(y => [SHELTER.rIn, SHELTER.rOut].forEach(r => { const t = mesh(new THREE.TorusGeometry(r, 0.05, 6, 48), frame, 0, y, 0); t.rotation.x = Math.PI / 2; g.add(t); }));
    [-1, 1].forEach(sx => [SHELTER.rIn, SHELTER.rOut].forEach(r => g.add(mesh(new THREE.BoxGeometry(0.12, H, 0.12), frame, sx * r * Math.sin(gap), H / 2 + 0.05, r * Math.cos(gap)))));
    const roof = mesh(new THREE.CylinderGeometry(SHELTER.rOut + 0.1, SHELTER.rOut + 0.1, 0.16, 40), frame, 0, H + 0.14, 0); g.add(roof);
    // sign above the doorway
    const c = document.createElement('canvas'); c.width = 640; c.height = 160; const k = c.getContext('2d');
    k.fillStyle = '#2a0c0c'; k.fillRect(0, 0, 640, 160); k.strokeStyle = '#ff6a4d'; k.lineWidth = 10; k.strokeRect(6, 6, 628, 148);
    k.fillStyle = '#ffd2c8'; k.font = '700 70px sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText('STORM SHELTER', 320, 84, 600);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.MeshBasicMaterial({ map: tex }); shel.mats.push(sm);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), sm); sign.position.set(0, H + 0.55, SHELTER.rOut + 0.02); g.add(sign);
    // two water valves with pipes into the walls
    VALVES.forEach((v, i) => {
      g.add(mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.05, 10), frame, v.x, 0.53, v.z));
      const pipe = mesh(new THREE.CylinderGeometry(0.08, 0.08, Math.abs(v.x) - SHELTER.rOut + 0.1, 8), frame, Math.sign(v.x) * (SHELTER.rOut + Math.abs(v.x)) / 2, 0.25, v.z); pipe.rotation.z = Math.PI / 2; g.add(pipe);
      const wheel = new THREE.Group(); wheel.position.set(v.x, 1.12, v.z); g.add(wheel);
      const rim = mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 22), red, 0, 0, 0); rim.rotation.x = Math.PI / 2; wheel.add(rim);
      [0, Math.PI / 2].forEach(a => { const sp = mesh(new THREE.BoxGeometry(0.6, 0.04, 0.05), red, 0, 0, 0); sp.rotation.y = a; wheel.add(sp); });
      shel.wheels.push(wheel);
      const lc = document.createElement('canvas'); lc.width = 256; lc.height = 96; const lk = lc.getContext('2d');
      lk.fillStyle = '#0c1628'; lk.fillRect(0, 0, 256, 96); lk.fillStyle = '#7fc8ff'; lk.font = '700 46px sans-serif'; lk.textAlign = 'center'; lk.textBaseline = 'middle'; lk.fillText('VALVE ' + (i + 1), 128, 50, 240);
      const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace; const lm = new THREE.MeshBasicMaterial({ map: lt }); shel.mats.push(lm);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), lm); lbl.position.set(v.x, 1.62, v.z); lbl.rotation.y = Math.sign(v.x) * Math.PI / 2; g.add(lbl);
    });
  }
  if (STORM) buildShelter();
  const insideShelter = () => S.mode === 'foot' && Math.hypot(S.foot.x, S.foot.z) < SHELTER.rIn + 0.1;   // anywhere inside the inner wall
  function updateStorm(dt) {
    const st = S.storm; if (!st.on) return;
    st.shielded = insideShelter() && st.valves[0] >= VALVE_TIME && st.valves[1] >= VALVE_TIME;
    if (st.phase === 'calm') { st.t -= dt; if (st.t <= 0) { st.phase = 'warn'; st.timer = STORM_WARN; sfx.alarm(); speakLines([tr('st_warnT') + '! ' + tr('st_msg')]); } }
    else if (st.phase === 'warn') { st.timer -= dt; if (st.timer <= 0) { st.timer = 0; st.phase = 'hit'; sfx.alarm(); speakLines([tr('st_hitSay')]); } }
    // hold E at a valve to pump water into its wall
    st.pumping = -1;
    if (S.mode === 'foot' && !S.action && !S.foot.air && keys.KeyE) {
      for (let i = 0; i < 2; i++) {
        if (st.valves[i] >= VALVE_TIME || Math.hypot(S.foot.x - VALVES[i].x, S.foot.z - VALVES[i].z) > 1.9) continue;
        st.valves[i] = Math.min(VALVE_TIME, st.valves[i] + dt); st.pumping = i; shel.wheels[i].rotation.y += dt * 4;
        if (st.valves[i] >= VALVE_TIME) { sfx.chime(); flash(tr('st_wallFull', { n: i + 1 })); }
        break;
      }
    }
    shel.water.forEach((w, i) => { w.scale.y = Math.max(0.001, st.valves[i] / VALVE_TIME * 2.5); });
    // the storm: −5 health/s unless shielded; +4/s inside the filled shelter
    st.exposed = st.phase === 'hit' && !st.shielded;
    if (st.exposed) { S.hp -= 5 * dt; S.hurtT = 0.25; }
    if (st.shielded) {
      S.hp = Math.min(100, S.hp + 4 * dt);
      if (st.phase === 'hit') { st.shieldT += dt; if (st.shieldT >= STORM_SAFE && !S.winAt) S.winAt = S.t + 0.5; }
    }
    // Geiger counter
    const rate = st.exposed ? 30 : st.phase === 'hit' ? 1.2 : st.phase === 'warn' ? 0.8 + (1 - st.timer / STORM_WARN) * 5 : 0;
    st.clickT -= dt;
    if (rate > 0 && st.clickT <= 0) { sfx.click(st.exposed ? 1.6 : 0.6); st.clickT = -Math.log(1 - Math.random()) / rate; }
  }

  // ---------- helpers
  function toast(text, secs) { msg.textContent = text; msg.style.display = 'block'; S.toast = secs || 3; }
  function setPause(p) {
    if (S.over || ovHelp.style.display === 'flex') return;
    S.paused = p; ovPause.style.display = p ? 'flex' : 'none';
  }
  function exit() { const cb = opts.onExit; stop(); if (cb) cb(); }

  function nearestRock(x, z) {
    let best = null, bd = 1e9;
    for (const r of rocks) { if (r.taken) continue; const d = Math.hypot(r.x - x, r.z - z); if (d < bd) { bd = d; best = r; } }
    return best ? { r: best, d: bd } : null;
  }
  function distTo(a, x, z) { return Math.hypot(a.x - x, a.z - z); }

  // ---------- input
  const onKeyDown = e => {
    if (e.repeat && e.code !== 'Space') return;
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === 'Escape') { if (mapOpen) { toggleMap(false); return; } if (!S.over) setPause(!S.paused); return; }
    if (k === 'KeyM' && !e.repeat) { toggleMap(); return; }
    if (mapOpen) return;
    if (k === 'KeyP') { setPause(!S.paused); return; }
    if (k === 'KeyE' && !S.paused && !S.over) interact();
    if (k === 'Space' && !e.repeat) jump();
    if (k === 'KeyC' && !e.repeat && !S.paused && !S.over) toggleView();
    if (k === 'KeyH' && !e.repeat) toggleService('heal');
    if (k === 'KeyR' && !e.repeat) toggleService('repair');
  };
  const onKeyUp = e => { keys[e.code] = false; };
  let dragging = false, lx = 0, ly = 0;
  const onDown = e => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.classList.add('drag'); try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } };
  const onMove = e => {
    if (!dragging) return;
    if (S.view === 'first') {
      const dx = (e.clientX - lx) * 0.006;
      if (S.mode === 'foot') S.foot.yaw -= dx; else S.cam.yawOff = clamp(S.cam.yawOff - dx, -2.2, 2.2);
      S.cam.fpPitch = clamp(S.cam.fpPitch - (e.clientY - ly) * 0.004, -1.2, 1.2);
    } else {
      S.cam.yawOff -= (e.clientX - lx) * 0.006; S.cam.pitchOff = clamp(S.cam.pitchOff + (e.clientY - ly) * 0.004, -0.25, 0.9);
    }
    S.cam.idle = 0; lx = e.clientX; ly = e.clientY;
  };
  const onUp = () => { dragging = false; canvas.classList.remove('drag'); };
  const onWheel = e => { e.preventDefault(); if (S.view === 'first') return; S.cam.zoom = clamp(S.cam.zoom * (1 + Math.sign(e.deltaY) * 0.1), 0.55, 2.4); };
  const onResize = () => {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const onBlur = () => { for (const k in keys) keys[k] = false; if (!S.over && ovHelp.style.display !== 'flex') setPause(true); };
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize); window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  pauseBtn.addEventListener('click', () => setPause(true));
  mapBtn.addEventListener('click', () => toggleMap(true));

  function flash(text) { viewTag.textContent = text; S.viewUntil = performance.now() + 1900; }
  // spoken one-time tips that teach how to manage oxygen (level 1)
  const tipsShown = {}; let tipQ = [], tipT = 0;
  function tip(k) { if (!S.tankOn || tipsShown[k]) return; tipsShown[k] = true; tipQ.push(k); }
  function updateTips(dt) {
    tipT -= dt;
    if (tipT > 0) return;
    if (tipQ.length) { const k = tipQ.shift(); tipEl.textContent = '💡 ' + tr(k); tipEl.style.opacity = '1'; tipT = 7.5; speakLines([tr(k)]); }
    else if (tipEl.style.opacity !== '0') tipEl.style.opacity = '0';
  }
  // oxygen (%) needed to get back to the base: walk straight home, or walk to the rover and drive
  function homeNeed() {
    const k = radStage() >= 2 ? 1.25 : 1, WALK = 4.6, DRIVE = 24, FO = 0.6 * k, CO = 0.35 * k;
    const c = S.car, dc = Math.max(0, Math.hypot(c.x, c.z) - LAB_RADIUS);
    S.homeViaRover = false;
    if (S.mode === 'car') return dc / DRIVE * CO;
    const f = S.foot, direct = Math.max(0, Math.hypot(f.x, f.z) - LAB_RADIUS) / WALK * FO;
    const via = S.rv > 0 ? Math.hypot(f.x - c.x, f.z - c.z) / WALK * FO + dc / DRIVE * CO : 1e9;
    if (via < direct) { S.homeViaRover = true; return via; }
    return direct;
  }
  // paid services at the lab: H heals the astronaut, R repairs the rover
  function toggleService(kind) {
    if (S.paused || S.over) return;
    if (kind === 'heal') {
      if (!nearMed() || S.hp >= 99.5) return;
      if (S.money < 1) { flash(tr('f_broke')); return; }
      S.svc.heal = !S.svc.heal;
    } else {
      if (!roverAtBase() || !nearWorkshop() || S.rv >= 99.5) return;
      if (S.money < 1) { flash(tr('f_broke')); return; }
      S.svc.repair = !S.svc.repair;
    }
    sfx.beep(S.svc[kind] ? 640 : 420, 0.08, 'sine', 0.1);
  }

  // ---------- camera view (C)
  function setView(v) {
    if (S.view === v) return;
    S.view = v;
    const fp = v === 'first';
    camera.fov = fp ? 74 : 62; camera.near = fp ? 0.12 : 0.4; camera.updateProjectionMatrix();
    S.cam.yawOff = 0; S.cam.fpPitch = 0; S.cam.idle = 0;
    flash(tr(fp ? 'v_first' : 'v_third'));
    sfx.beep(fp ? 700 : 520, 0.07, 'sine', 0.08);
  }
  function toggleView() { S.autoFP = false; setView(S.view === 'third' ? 'first' : 'third'); }

  // ---------- stones: the rover takes damage when it hits them
  function roverHit(nx, nz, pen, px, pz, top, fx, fz) {
    const c = S.car;
    c.x += nx * pen; c.z += nz * pen;
    const into = Math.max(0, -(c.v * (fx * nx + fz * nz))), frac = into / (Math.abs(c.v) + 0.001);
    if (into > 2.5 && S.hitT <= 0) {
      const dmg = Math.max(1, Math.min(45, (into - 2) * 0.9 * (0.8 + top * 0.5)));
      S.rv = Math.max(0, S.rv - dmg); S.lastDmg = Math.round(dmg); S.hitUntil = performance.now() + 2200; S.hitT = 0.6;
      S.shake = Math.min(1.6, 0.4 + dmg / 14); S.hurtT = Math.max(S.hurtT, 0.12);
      sfx.crash(); puff(px - nx * 0.5, c.y + c.h + 0.8, pz - nz * 0.5, 10, 2.6);
      c.v *= 1 - 1.2 * frac;                              // bounce back
    } else c.v *= 1 - 0.5 * frac;
  }
  function collideRover(dt) {
    const c = S.car; S.hitT -= dt;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), ccx = Math.floor(c.x / CS), ccz = Math.floor(c.z / CS);
    for (const off of [1.6, -1.6]) {                       // the base is solid
      const hit = labContact(c.x + fx * off, c.z + fz * off, 1.75);
      if (hit) roverHit(hit.nx, hit.nz, hit.pen, c.x + fx * off, c.z + fz * off, 3, fx, fz);
    }
    if (Math.hypot(c.x, c.z) < 80) return;
    for (const off of [1.6, -1.6]) {
      const px = c.x + fx * off, pz = c.z + fz * off;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const r of chunkRocks(ccx + dx, ccz + dz)) {
        if (r.s < 0.6) continue;                              // pebbles are harmless
        const ddx = px - r.wx, ddz = pz - r.wz;
        if (Math.abs(ddx) > 7 || Math.abs(ddz) > 7) continue;
        if (c.h + 0.35 > r.top) continue;                      // hopped over it
        const rad = 1.75 + r.r, d2 = ddx * ddx + ddz * ddz;
        if (d2 >= rad * rad) continue;
        const d = Math.sqrt(d2) || 0.01;
        roverHit(ddx / d, ddz / d, rad - d, px, pz, r.top, fx, fz);
      }
    }
  }

  // ---------- jumping
  function jump() {
    if (S.action || S.paused || S.over) return;
    if (S.mode === 'foot') {
      const f = S.foot; if (f.air) return;
      const weak = S.en <= 0 ? 0.6 : 1;
      f.air = true; f.vh = JUMP_FOOT * weak; S.en = Math.max(0, S.en - 0.35);
      puff(f.x, f.y, f.z, 7, 2.2); sfx.beep(380, 0.09, 'sine', 0.1); sfx.beep(560, 0.1, 'sine', 0.08, 0.06);
    } else {
      const c = S.car; if (c.air) return;
      const weak = S.en <= 0 ? 0.6 : 1;
      c.air = true; c.vh = JUMP_CAR * weak; S.en = Math.max(0, S.en - 1.1);
      puff(c.x, c.y, c.z, 10, 3.2); sfx.beep(240, 0.12, 'sine', 0.14); sfx.beep(420, 0.12, 'sine', 0.1, 0.07);
    }
  }
  function land(o, strong) {
    o.air = false; o.h = 0; const hard = Math.min(1, Math.abs(o.vh) / 7); o.vh = 0;
    puff(o.x, o.y, o.z, strong ? 12 : 8, 1.4 + hard * 2.2); sfx.beep(strong ? 90 : 130, 0.14, 'triangle', 0.18 * (0.5 + hard));
    return hard;
  }

  // ---------- interaction
  const roverAtBase = () => Math.hypot(S.car.x, S.car.z) < LAB_RADIUS;
  const nearMed = () => S.mode === 'foot' && distTo(MED, S.foot.x, S.foot.z) < 5.5;
  const nearWorkshop = () => S.mode === 'foot' && distTo(WORKSHOP, S.foot.x, S.foot.z) < 5.5;
  function context() {
    // returns what E would do right now
    if (S.action) return null;
    const f = S.foot, c = S.car;
    if (S.mode === 'car') return Math.abs(c.v) < 3 && !c.air ? { type: 'exit', text: tr('p_exit') } : null;
    if (f.air) return null;
    if (S.storm.on) for (let i = 0; i < 2; i++) if (S.storm.valves[i] < VALVE_TIME && Math.hypot(f.x - VALVES[i].x, f.z - VALVES[i].z) <= 1.9) return { type: 'valve', text: tr('p_valve', { n: i + 1, p: Math.round(S.storm.valves[i] / VALVE_TIME * 100) }) };
    if (S.mission) {
      if (S.mirrors.pack > 0) {
        let bs = null, bd = 1e9; for (const m of MIR_SPOTS) if (!m.placed) { const d = distTo(m, f.x, f.z); if (d < bd) { bd = d; bs = m; } }
        if (bs && bd < 6) return { type: 'mirror', spot: bs, text: tr('p_mirror') };
      }
      if (!S.tower.fixed && distTo(TOWER, f.x, f.z) < 6.5) return { type: 'repair', text: tr('p_repair') };
    }
    const nr = nearestRock(f.x, f.z);
    if (nr && nr.d < 3.4 && S.carried < CAP_FOOT) return { type: 'collect', rock: nr.r, text: tr('p_collect') };
    const dRover = distTo(c, f.x, f.z);
    if (S.carried > 0 && dRover < 7 && S.cargo < CAP_CARGO) return { type: 'load', text: tr('p_load') };
    if ((S.carried > 0 || (S.cargo > 0 && roverAtBase())) && distTo(STORE, f.x, f.z) < 5.5) return { type: 'store', text: tr('p_store') };
    if (dRover < 6) return { type: 'enter', text: tr('p_enter') };
    return null;
  }
  function interact() {
    const c = context(); if (!c || c.type === 'valve') return;
    if (c.type === 'enter') { tip('tip_rover'); S.mode = 'car'; S.cam.fpPitch = 0; S.cam.yawOff = 0; attachToSeat(true); sfx.beep(300, 0.1, 'square', 0.12); return; }
    if (c.type === 'exit') {
      S.mode = 'foot'; S.cam.fpPitch = 0; S.cam.yawOff = 0; attachToSeat(false);
      const car = S.car, side = 3.0;
      S.foot.x = car.x + Math.cos(car.yaw) * side; S.foot.z = car.z - Math.sin(car.yaw) * side; S.foot.yaw = car.yaw;
      S.foot.speed = 0; S.foot.y = heightAt(S.foot.x, S.foot.z); S.foot.h = 0; S.foot.vh = 0; S.foot.air = false; sfx.beep(260, 0.1, 'square', 0.12); return;
    }
    if (c.type === 'mirror') S.action = { type: 'mirror', t: 0, dur: 2.6, spot: c.spot, text: tr('a_mirror') };
    if (c.type === 'repair') S.action = { type: 'repair', t: 0, dur: Math.max(0.5, TOWER_WORK - S.tower.prog), text: tr('a_repair') };
    if (c.type === 'collect') S.action = { type: 'collect', t: 0, dur: 1.4, rock: c.rock, text: tr('a_collect') };
    if (c.type === 'load') S.action = { type: 'load', t: 0, dur: 1.2, text: tr('a_load') };
    if (c.type === 'store') S.action = { type: 'store', t: 0, dur: 2.0, text: tr('a_store') };
  }
  function attachToSeat(on) {
    if (on) { rover.seat.add(astro.root); astro.root.position.set(0, 0.0, 0); astro.root.rotation.set(0, 0, 0); astro.root.scale.setScalar(0.85); }
    else { scene.add(astro.root); astro.root.scale.setScalar(1); }
  }
  function finishAction() {
    const a = S.action; S.action = null;
    if (a.type === 'collect') {
      a.rock.taken = true; a.rock.mesh.visible = false; a.rock.halo.visible = false;
      S.carried++; a.rock.site.left--; sfx.pick(); tip('tip_rock');
      if (a.rock.site.left <= 0) { a.rock.site.beam.material.color.set(0x6b7380); a.rock.site.beam.material.opacity = 0.06; }
    } else if (a.type === 'mirror') {
      a.spot.placed = true; S.mirrors.pack--; S.mirrors.placed++; sfx.chime(); flash(tr('f_mirror', { n: S.mirrors.placed }));
    } else if (a.type === 'repair') {
      S.tower.prog = TOWER_WORK; S.tower.fixed = true; S.tower.fixT = 0; sfx.chime(); flash(tr('f_tower')); S.winAt = S.t + 2.8;
    } else if (a.type === 'load') {
      const n = Math.min(S.carried, CAP_CARGO - S.cargo); S.carried -= n; S.cargo += n; sfx.pick();
    } else if (a.type === 'store') {
      const n = S.carried + (roverAtBase() ? S.cargo : 0); S.delivered += n; S.carried = 0; if (roverAtBase()) S.cargo = 0; sfx.chime();
      S.money += n * REWARD;
      if (S.tankOn) { S.makerQ += n * ROCK_O2; flash(tr('f_oxy', { o: n * ROCK_O2, m: n * REWARD })); tip('tip_maker'); }
      else { flash(tr('f_earn', { m: n * REWARD })); if (S.delivered >= GOAL) win(); }
    }
  }

  // ---------- end states
  function endCard(title, text, win_) {
    S.over = true; S.paused = true;
    ovEnd.innerHTML = '<div class="mg-card mg-glass"><h2>' + title + '</h2><p>' + text + '</p><button class="mg-btn pri" id="a" type="button">' + tr('again') +
      '</button><button class="mg-btn" id="q" type="button">' + tr('quit') + '</button></div>';
    ovEnd.style.display = 'flex';
    speakLines([title, text]);
    ovEnd.querySelector('#a').onclick = () => { const o = opts; stop(); start(o); };
    ovEnd.querySelector('#q').onclick = exit;
    sfx.drive(0, false);
  }
  function win() {
    if (S.storm.on) { const m = Math.floor(S.t / 60), sc = Math.floor(S.t % 60); endCard(tr('swinT'), tr('swinD', { t: m + ':' + String(sc).padStart(2, '0') }), true); return; }
    if (S.tankOn) { const m = Math.floor(S.t / 60), sc = Math.floor(S.t % 60); endCard(tr('winT1'), tr('winD1', { n: S.delivered, t: m + ':' + String(sc).padStart(2, '0') }) + ' ' + tr('money') + ': $' + Math.floor(S.money) + '.', true); return; }
    if (S.mission) { const m = Math.floor(S.t / 60), sc = Math.floor(S.t % 60); endCard(tr('mwinT'), tr('mwinD', { t: m + ':' + String(sc).padStart(2, '0') }), true); return; }
    const m = Math.floor(S.t / 60), s = Math.floor(S.t % 60);
    const d = opts.discovery ? opts.discovery.discovery : '';
    endCard(tr('winT'), tr('winD', { d, n: S.delivered, t: m + ':' + String(s).padStart(2, '0') }) + ' ' + tr('money') + ': $' + Math.floor(S.money) + '.', true);
  }
  function lose(cause) { endCard(tr('loseT'), tr(cause), false); }

  // ---------- update
  function radStage() { return S.rad >= 80 ? 3 : S.rad >= 55 ? 2 : S.rad >= 30 ? 1 : 0; }

  function update(dt) {
    S.t += dt;
    if (!S.mission) S.clock = (S.clock + dt / DAY_LEN) % 1;
    updateSun();
    const f = S.foot, c = S.car, stage = radStage();
    const stageSpeed = [1, 0.88, 0.72, 0.5][stage];
    const pos = subject();
    const inLab = Math.hypot(pos.x, pos.z) < LAB_RADIUS;

    // ---- movement
    const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const turn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    if (S.mode === 'foot') {
      if (S.action && S.action.type === 'repair' && (keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight || keys.Space)) {
        S.tower.prog += S.action.t; S.action = null;          // walking away pauses the repair
      }
      if (S.action) {
        S.action.t += dt; if (S.action.t >= S.action.dur) finishAction();
        f.speed = lerp(f.speed, 0, 1 - Math.exp(-10 * dt));
      } else {
        f.yaw += turn * (f.air ? 1.3 : 2.4) * dt;
        const run = keys.ShiftLeft || keys.ShiftRight;
        const target = fwd > 0 ? (run ? 8.5 : 4.6) * stageSpeed : fwd < 0 ? -2.6 : 0;
        f.speed = lerp(f.speed, target, 1 - Math.exp(-(f.air ? 1.2 : 7) * dt));
        const nx = f.x + Math.sin(f.yaw) * f.speed * dt, nz = f.z + Math.cos(f.yaw) * f.speed * dt;
        const dh = heightAt(nx, nz) - heightAt(f.x, f.z);
        const slope = dh / Math.max(0.01, Math.abs(f.speed * dt));
        if (Math.abs(f.speed) < 0.01 || slope < 1.1 || (f.air && f.h > dh + 0.3)) { f.x = nx; f.z = nz; } else f.speed *= 0.3;
        f.x = clamp(f.x, -WORLD, WORLD); f.z = clamp(f.z, -WORLD, WORLD);
      }
      for (let it = 0; it < 3; it++) {          // the base is solid: slide along its walls
        const hit = labContact(f.x, f.z, 0.45); if (!hit) break;
        f.x += hit.nx * hit.pen; f.z += hit.nz * hit.pen; f.speed *= 0.8;
      }
      f.y = heightAt(f.x, f.z);
      if (f.air) {
        f.h += f.vh * dt; f.vh -= JUMP_G * dt;
        if (f.h <= 0 && f.vh < 0) { const hard = land(f, false); f.landT = 0.1 + hard * 0.14; f.speed *= 0.6; }
      }
      f.landT = Math.max(0, f.landT - dt);
      f.phase += Math.abs(f.speed) * dt * (f.air ? 0.3 : 1.7);
    } else {
      // rover physics
      const empty = S.en <= 0, hf = S.rv >= 50 ? 1 : 0.4 + 0.6 * (S.rv / 50);
      let vmax = (empty ? 6 : 34) * stageSpeed * hf; if (S.rv <= 0) vmax = Math.min(vmax, 3);
      const fwdDir = { x: Math.sin(c.yaw), z: Math.cos(c.yaw) };
      const ahead = heightAt(c.x + fwdDir.x * 3, c.z + fwdDir.z * 3) - heightAt(c.x - fwdDir.x * 3, c.z - fwdDir.z * 3);
      const slope = ahead / 6;
      let acc = fwd > 0 ? 15 : fwd < 0 ? -12 : 0;
      if (keys.KeyB) acc = -Math.sign(c.v) * 22;
      acc -= slope * 11;
      if (c.air) acc = 0;                           // no traction in the air
      c.v += acc * dt;
      if (!c.air) {
        c.v -= c.v * 0.18 * dt;                     // rolling drag
        if (!fwd && !keys.KeyB) c.v *= 1 - clamp(0.6 * dt, 0, 1);
      }
      const lim = vmax * clamp(1 - Math.max(0, slope) * 1.3, 0.2, 1);
      c.v = clamp(c.v, -9, lim);
      const steerMax = lerp(0.62, 0.17, clamp(Math.abs(c.v) / 30, 0, 1));
      c.steer = lerp(c.steer, turn * steerMax, 1 - Math.exp(-6 * dt));
      c.yaw += (c.v * Math.tan(c.steer) / 4.6) * dt * (c.air ? 0.35 : 1);
      c.x = clamp(c.x + Math.sin(c.yaw) * c.v * dt, -WORLD, WORLD);
      c.z = clamp(c.z + Math.cos(c.yaw) * c.v * dt, -WORLD, WORLD);
      collideRover(dt);
      if (c.air) {
        c.h += c.vh * dt; c.vh -= JUMP_G_CAR * dt;
        if (c.h <= 0 && c.vh < 0) { const hard = land(c, true); c.v *= 1 - 0.12 * hard; if (hard > 0.7) S.en = Math.max(0, S.en - 0.6); }
      }
      sfx.drive(Math.abs(c.v) / 34 * (c.air ? 0.4 : 1), !empty || Math.abs(c.v) > 0.5);
    }
    if (S.mode !== 'car') sfx.drive(0, false);

    // ---- environment: lab, craters, flare
    const cur = subject();
    S.shadeT -= dt;
    if (S.shadeT <= 0) {
      S.shadeT = 0.3;
      const h0 = heightAt(cur.x, cur.z);
      const rim = (heightAt(cur.x + 45, cur.z) + heightAt(cur.x - 45, cur.z) + heightAt(cur.x, cur.z + 45) + heightAt(cur.x, cur.z - 45)) / 4;
      S.shade = rim - h0 > 7;
    }
    const fl = S.flare; fl.next -= dt;
    if (!fl.on && fl.next < 6 && fl.next > 0) { if (!fl.warn) sfx.alarm(); fl.warn = true; }
    if (!fl.on && fl.next <= 0) { fl.on = true; fl.t = 20; fl.warn = false; sfx.alarm(); }
    if (fl.on) { fl.t -= dt; if (fl.t <= 0) { fl.on = false; fl.next = 80 + Math.random() * 70; } }

    // ---- rover: repair at the lab, smoke when badly damaged
    const carInLab = Math.hypot(c.x, c.z) < LAB_RADIUS;
    S.shake = Math.max(0, S.shake - 2.2 * dt);
    if (S.rv < 35) {
      S.smokeT -= dt;
      if (S.smokeT <= 0) {
        S.smokeT = 0.1 + (S.rv / 35) * 0.3;
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        puff(c.x + fx * 2.0, c.y + c.h + 2.0, c.z + fz * 2.0, 1, 0.4, S.rv <= 0 ? 0x151515 : 0x3a3a3a, 1.6);
      }
    }

    // ---- temperature: sunlight / shadow / mirrors -> surroundings -> suit
    S.tempT -= dt;
    if (S.tempT <= 0) {
      S.tempT = 0.2;
      const inCrater = !S.mission || Math.hypot(cur.x - TOWER.x, cur.z - TOWER.z) < SHADOW.R * 1.1;
      S.sunlit = sunSin > 0.005 && !(inCrater && sunBlocked(cur.x, cur.z, S.sunU.x, S.sunU.z, S.tanE));
    }
    let ambT = !S.sunlit ? T_NIGHT : S.mission ? T_DAY : T_NIGHT + (T_DAY - T_NIGHT) * smooth(-0.02, 0.5, sunSin);
    if (S.mission && !S.sunlit && S.mirrors.placed > 0) ambT += S.mirrors.placed * MIRROR_HEAT * (1 - smooth(POOL_R * 0.55, POOL_R * 1.1, Math.hypot(cur.x - TOWER.x, cur.z - TOWER.z)));
    S.amb += (ambT - S.amb) * (1 - Math.exp(-(S.mission ? 1.8 : 0.9) * dt));
    const expo = S.mode === 'car' ? 0.4 : 1;
    {
      let sT, sR;
      if (inLab) { sT = 22; sR = 1.2; }
      else { sT = 22 + (S.amb - 22) * 0.3 * expo * (S.mission ? 1 : S.en > 0 ? 0.18 : 1); sR = sT < S.suit ? 0.38 : 0.13; }
      S.suit += (sT - S.suit) * (1 - Math.exp(-sR * dt));
    }

    // ---- vitals
    let radRate = 0;
    const carMode = S.mode === 'car';
    if (!inLab) {
      radRate = carMode ? 0.22 : 0.55;
      if (S.shade) radRate *= 0.6;
      if (fl.on) radRate *= 3.5;
      if (sunSin < 0 && !S.mission) radRate *= 0.5;
    }
    S.rad = clamp(S.rad + radRate * dt - (inLab ? 6 * dt : 0), 0, 100);
    const runK = !carMode && (keys.ShiftLeft || keys.ShiftRight) && fwd > 0 && !S.action ? 1.8 : 1;
    S.o2Rate = inLab ? 0 : (carMode ? 0.35 : 0.6) * runK * (stage >= 2 ? 1.25 : 1);
    S.refilling = false;
    if (inLab) {
      let d = Math.min(12 * dt, 100 - S.o2);
      if (S.tankOn) d = Math.max(0, Math.min(d, S.tank / REFILL_COST));
      if (d > 1e-5) { S.o2 += d; S.refilling = true; if (S.tankOn) S.tank = Math.max(0, S.tank - d * REFILL_COST); }
      S.en = clamp(S.en + 10 * dt, 0, 100);
      if (S.refilling && S.o2 < 92) tip('tip_refill');
    } else {
      if (S.t > 2) tip('tip_out');
      if (runK > 1) tip('tip_run');
      S.o2 = clamp(S.o2 - S.o2Rate * dt, 0, 100);
      if (S.o2 < 50) tip('tip_half');
      S.en = clamp(S.en - (carMode ? 0.08 + 0.45 * Math.abs(S.car.v) / 34 : 0.1) * dt - (Math.abs(S.amb - 22) * 0.0006 * expo + (S.suit < 10 ? (10 - S.suit) * 0.05 : 0) + (S.suit > 38 ? (S.suit - 38) * 0.06 : 0)) * dt, 0, 100);
      let loss = S.rad * 0.002 + [0, 0.1, 0.35, 0.9][stage];
      if (S.o2 <= 0) loss += 4;
      if (S.suit < 2) loss += (2 - S.suit) * 0.1; else if (S.suit > 46) loss += (S.suit - 46) * 0.15;
      S.hp -= loss * dt; if (loss > 0.4) S.hurtT = 0.25;
    }
    S.o2Line = inLab ? 0 : Math.min(100, homeNeed() * 1.3 + 3);
    // ---- base oxygen tank: the oxygen maker turns rocks into air
    if (S.tankOn) {
      if (S.makerQ > 0) { const d = Math.min(S.makerQ, MAKER_RATE * dt); S.makerQ -= d; S.tank = Math.min(100, S.tank + d); }
      if (S.tank < 8) S.tank += 0.12 * dt;                      // emergency backup: very slow
      if (S.tank >= 99.95 && !S.winAt) S.winAt = S.t + 1.6;
      S.respawnT -= dt;
      if (S.respawnT <= 0) {
        S.respawnT = 1;
        if (!S.winAt && S.carried === 0 && S.cargo === 0 && S.makerQ <= 0 && rocks.length && rocks.every(r => r.taken)) {
          rocks.forEach(r => { r.taken = false; r.mesh.visible = true; r.halo.visible = true; });
          SITES.forEach(si => { si.left = 4; if (si.beam) { si.beam.material.color.set(0x55dfff); si.beam.material.opacity = 0.16; } });
          flash(tr('f_newRocks'));
        }
      }
    }
    updateTips(dt);
    // ---- paid services at the lab
    S.svcT -= dt;
    if (S.svc.heal) {
      const d = Math.min(8 * dt, 100 - S.hp, S.money / HEAL_COST);
      if (!nearMed() || S.hp >= 99.99) S.svc.heal = false;
      else if (d <= 1e-4) { S.svc.heal = false; flash(tr('f_broke')); }
      else { S.hp += d; S.money -= d * HEAL_COST; if (S.svcT <= 0) { sfx.beep(900, 0.04, 'sine', 0.05); S.svcT = 0.22; } }
    }
    if (S.svc.repair) {
      const d = Math.min(12 * dt, 100 - S.rv, S.money / REPAIR_COST);
      if (!roverAtBase() || !nearWorkshop() || S.rv >= 99.99) S.svc.repair = false;
      else if (d <= 1e-4) { S.svc.repair = false; flash(tr('f_broke')); }
      else { S.rv += d; S.money -= d * REPAIR_COST; if (S.svcT <= 0) { sfx.beep(520, 0.04, 'square', 0.04); S.svcT = 0.22; } }
    }
    if (S.hp <= 0) { S.hp = 0; lose(S.storm.on && S.storm.phase === 'hit' ? 'lose_storm' : S.suit < 0 ? 'lose_cold' : S.suit > 44 ? 'lose_heat' : S.o2 <= 0 ? 'lose_o2' : 'lose_rad'); return; }

    // lab door
    const dDoor = Math.hypot(S.foot.x - DOOR.x, S.foot.z - DOOR.z), dCar = Math.hypot(S.car.x - DOOR.x, S.car.z - DOOR.z);
    S.doorOpen = lerp(S.doorOpen, (dDoor < 8 || dCar < 8) ? 1 : 0, 1 - Math.exp(-4 * dt));
    lab.door.position.y = 1.4 + S.doorOpen * 1.95;
    lab.tankFill.scale.y = Math.max(0.02, S.tank / 100 * 2.28);
    lab.makerGlow.material.color.set(S.makerQ > 0 ? (Math.sin(S.t * 8) > 0 ? 0xff9a3c : 0xff6a1c) : 0x3a2a22);
    lab.holo.rotation.y = S.t * 0.6; lab.holo.position.y = 1.9 + Math.sin(S.t * 1.5) * 0.08;

    // beeps
    S.lastBeepO2 -= dt;
    if (S.o2 < 20 && !inLab && S.lastBeepO2 <= 0) { sfx.beep(880, 0.1, 'square', 0.14); S.lastBeepO2 = S.o2 < 8 ? 0.6 : 1.4; }

    S.inLab = inLab;

    // going inside the base switches to first person; stepping out brings the old view back
    const inside = S.mode === 'foot' && inBuilding(pos.x, pos.z);
    if (!S.inBase && inside) { S.inBase = true; if (S.view === 'third') { setView('first'); S.autoFP = true; } }
    else if (S.inBase && !inside) { S.inBase = false; if (S.autoFP) { setView('third'); S.autoFP = false; } }
    updateMission(dt);
    updateStorm(dt);
    if (S.hp <= 0 && !S.over) { S.hp = 0; lose('lose_storm'); return; }
    if (S.winAt && S.t >= S.winAt) { S.winAt = 0; win(); }
  }

  // ---------- sun, light, sky
  const sunCol = new THREE.Color(), sunLowC = new THREE.Color(0xff9a5c), sunHighC = new THREE.Color(0xfff1dc);
  function updateSun() {
    let e, ux, uz;
    if (S.mission) { e = SH_E; ux = SH_U.x; uz = SH_U.z; }
    else { e = SUN_MAX * Math.sin(Math.PI * 2 * (S.clock - 0.25)); const az = 0.9 + Math.PI * 2 * S.clock; ux = Math.sin(az); uz = Math.cos(az); }
    const ce = Math.cos(e); sunSin = Math.sin(e);
    sunDir.set(ux * ce, sunSin, uz * ce); S.sunU.x = ux; S.sunU.z = uz; S.tanE = Math.tan(Math.max(e, 0.01));
    const day = smooth(-0.03, 0.07, sunSin), lo = 0.55 + 0.45 * smooth(0.05, 0.5, sunSin);
    sunLight.intensity = 3.4 * day * lo;
    sunCol.copy(sunLowC).lerp(sunHighC, smooth(0.02, 0.35, sunSin)); if (S.flare.on) sunCol.set(0xffb894);
    sunLight.color.copy(sunCol);
    hemi.intensity = 0.8 + 0.2 * day; ambL.intensity = 0.62 + 0.1 * day; fill.intensity = 0.6 + 0.3 * (1 - day);
    renderer.shadowMap.autoUpdate = sunSin > 0.01;               // no shadow pass at night
    sunSpr.visible = sunSin > -0.06; sunDisc.visible = sunSin > -0.012; sunSpr.material.opacity = 0.45 + 0.55 * day;
    stars.rotation.y = -S.clock * Math.PI * 2;
  }
  function syncSky(tx, ty, tz) {
    sunLight.position.set(tx + sunDir.x * 220, ty + sunDir.y * 220, tz + sunDir.z * 220);
    sunLight.target.position.set(tx, ty, tz); sunLight.target.updateMatrixWorld();
    const cp = camera.position;
    stars.position.copy(cp);
    earth.position.set(cp.x - 3300, 2200, cp.z - 4300); clouds.position.copy(earth.position); earthGlow.position.copy(earth.position);
    sunSpr.position.set(cp.x + sunDir.x * 5600, sunDir.y * 5600, cp.z + sunDir.z * 5600);
    sunDisc.position.set(cp.x + sunDir.x * 5580, sunDir.y * 5580, cp.z + sunDir.z * 5580);
  }

  // ---------- visuals
  const tmpV = new THREE.Vector3();
  function poseCharacters(dt) {
    const f = S.foot, c = S.car;
    // rover pose from 4 wheel contacts
    const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
    const ph = (lx, lz) => heightAt(c.x + lx * co + lz * si, c.z - lx * si + lz * co);
    const hFL = ph(1.6, 2.1), hFR = ph(-1.6, 2.1), hRL = ph(1.6, -2.1), hRR = ph(-1.6, -2.1);
    const targetY = (hFL + hFR + hRL + hRR) / 4;
    const pitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, 4.2), roll = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, 3.2);
    const k = 1 - Math.exp(-12 * dt);
    c.y = targetY; c.pitch = lerp(c.pitch, pitch, 1 - Math.exp(-20 * dt)); c.roll = lerp(c.roll, roll, 1 - Math.exp(-20 * dt));
    rover.root.position.set(c.x, c.y + c.h, c.z);
    rover.root.rotation.set(0, c.yaw, 0);
    const bodyPitch = c.pitch + (c.air ? clamp(c.vh * 0.035, -0.25, 0.25) : 0);
    rover.body.rotation.set(-bodyPitch, 0, c.roll);
    // suspension: every wheel reaches the real ground under it
    rover.wheels.forEach(w => {
      const lx = w.position.x, lz = w.position.z;
      const plane = c.y + c.h + lz * Math.sin(bodyPitch) + lx * Math.sin(c.roll);
      const want = clamp(heightAt(c.x + lx * co + lz * si, c.z - lx * si + lz * co) - plane, -0.55, 0.4);
      w.position.y = 0.72 + want - 0.04;
    });
    rover.wheels.forEach((w, i) => { w.children[0].rotation.x += c.v * dt / 0.72; w.children[1].rotation.x = w.children[0].rotation.x; if (i < 2) w.rotation.y = c.steer * 0.7; });
    rover.cargoRocks.forEach((r, i) => { r.visible = i < S.cargo; });

    // astronaut
    astro.root.visible = S.view !== 'first';
    rover.hood.visible = !(S.view === 'first' && S.mode === 'car');   // keep the windscreen view clear
    if (S.mode === 'foot') {
      astro.root.position.set(f.x, f.y + f.h, f.z); astro.root.rotation.set(0, f.yaw, 0);
      const sw = Math.sin(f.phase) * Math.min(1, Math.abs(f.speed) / 4) * 0.8;
      astro.legL.rotation.x = sw; astro.legR.rotation.x = -sw; astro.armL.rotation.x = -sw * 0.8; astro.armR.rotation.x = sw * 0.8;
      let lean = 0, crouch = 0;
      if (S.action) { const p = S.action.t / S.action.dur; lean = Math.sin(p * Math.PI) * 0.55; crouch = Math.sin(p * Math.PI) * 0.25; astro.armL.rotation.x = astro.armR.rotation.x = -1.0 * Math.sin(p * Math.PI); }
      if (f.air) {
        const up = clamp(f.vh / JUMP_FOOT, -1, 1);          // +1 rising, -1 falling
        astro.armL.rotation.x = astro.armR.rotation.x = -1.6 - up * 0.5;
        astro.armL.rotation.z = 0.3 + (1 - up) * 0.25; astro.armR.rotation.z = -(0.3 + (1 - up) * 0.25);
        astro.legL.rotation.x = -0.7 * (0.5 + up * 0.5) + 0.1; astro.legR.rotation.x = 0.35 + (1 - up) * 0.15;
        lean = 0.12 * up;
      } else { astro.armL.rotation.z = 0; astro.armR.rotation.z = 0; }
      if (f.landT > 0) crouch = Math.max(crouch, f.landT * 2.2);
      astro.body.rotation.x = lean; astro.body.position.y = -crouch;
    } else {
      astro.legL.rotation.x = astro.legR.rotation.x = -1.35; astro.armL.rotation.x = astro.armR.rotation.x = -0.9; astro.armL.rotation.z = astro.armR.rotation.z = 0;
      astro.body.rotation.x = 0; astro.body.position.y = 0.02;
    }
    // carried rocks glow in the backpack indicator is HUD-only
  }

  function updateCamera(dt) {
    const s = subject(), cam = S.cam, car = S.mode === 'car';
    cam.idle += dt;
    const fp = S.view === 'first';
    cross.style.display = fp && !car ? 'block' : 'none';
    if (!dragging && cam.idle > (fp ? 1.2 : 2.5)) cam.yawOff = lerp(cam.yawOff, 0, 1 - Math.exp(-1.5 * dt));
    if (fp) {
      // first person: eyes of the astronaut, or the driver's seat of the rover
      let ex, ey, ez, yaw;
      if (car) {
        rover.root.updateMatrixWorld(true); rover.eye.getWorldPosition(tmpV);
        ex = tmpV.x; ey = tmpV.y; ez = tmpV.z; yaw = s.yaw + cam.yawOff;
      } else {
        const bob = s.air ? 0 : Math.sin(s.phase * 2) * 0.045 * Math.min(1, Math.abs(s.speed) / 4);
        const crouch = S.action ? Math.sin(S.action.t / S.action.dur * Math.PI) * 0.35 : s.landT > 0 ? s.landT * 1.2 : 0;
        ex = s.x + Math.sin(s.yaw) * 0.14; ez = s.z + Math.cos(s.yaw) * 0.14; ey = s.y + s.h + 1.68 + bob - crouch; yaw = s.yaw;
      }
      const p = cam.fpPitch, cp = Math.cos(p);
      camera.position.set(ex, ey, ez);
      camera.lookAt(ex + Math.sin(yaw) * cp, ey + Math.sin(p), ez + Math.cos(yaw) * cp);
      cam.x = ex; cam.y = ey; cam.z = ez; cam.yaw = yaw;
      if (S.shake > 0.01) { camera.position.x += (Math.random() - 0.5) * S.shake * 0.35; camera.position.y += (Math.random() - 0.5) * S.shake * 0.35; }
      syncSky(s.x, s.y + 1.5, s.z);
      return;
    }
    const targetYaw = s.yaw + cam.yawOff;
    cam.yaw += angDiff(cam.yaw, targetYaw) * (1 - Math.exp(-(car ? 3.2 : 4.5) * dt));
    const dist = (car ? 14.5 : 6.6) * cam.zoom, pitch = (car ? 0.3 : 0.34) + cam.pitchOff;
    const ty = s.y + s.h * 0.55 + (car ? 2.0 : 1.5);
    const tx = s.x, tz = s.z;
    const cx = tx - Math.sin(cam.yaw) * Math.cos(pitch) * dist, cz = tz - Math.cos(cam.yaw) * Math.cos(pitch) * dist;
    let cy = ty + Math.sin(pitch) * dist + (car ? 1.2 : 0.6);
    cy = Math.max(cy, heightAt(cx, cz) + 1.6);
    const k = 1 - Math.exp(-14 * dt);
    cam.x = lerp(cam.x, cx, k); cam.y = lerp(cam.y, cy, k); cam.z = lerp(cam.z, cz, k);
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(tx + Math.sin(cam.yaw) * 2, ty + 0.3, tz + Math.cos(cam.yaw) * 2);
    if (S.shake > 0.01) camera.position.set(cam.x + (Math.random() - 0.5) * S.shake * 0.5, cam.y + (Math.random() - 0.5) * S.shake * 0.5, cam.z + (Math.random() - 0.5) * S.shake * 0.4);
    // light & sky follow
    syncSky(tx, ty, tz);
  }

  // ---------- HUD
  let hudT = 0, mapT = 0;
  function objective() {
    const f = S.foot, c = S.car, carrying = S.carried + S.cargo;
    if (S.storm.on) {
      const st = S.storm;
      if (st.phase === 'calm') return { text: tr('obj_survey'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_lab') };
      if (st.shielded) return { text: tr(st.phase === 'hit' ? 'sobj_ok' : 'sobj_wait'), tx: 0, tz: 0, label: tr('tgt_shelter') };
      if (S.mode === 'car' || !inBuilding(f.x, f.z)) return { text: tr('sobj_run'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_shelter') };
      for (let i = 0; i < 2; i++) if (st.valves[i] < VALVE_TIME) return { text: tr('sobj_valve', { n: i + 1 }), tx: VALVES[i].x, tz: VALVES[i].z, label: tr('tgt_valve', { n: i + 1 }) };
      return { text: tr('sobj_enter'), tx: 0, tz: 0, label: tr('tgt_shelter') };
    }
    if (S.mission) {
      let tx, tz, text, label;
      if (S.mirrors.pack > 0) {
        let bs = MIR_SPOTS[0], bd = 1e9; const sj = subject();
        for (const m of MIR_SPOTS) if (!m.placed) { const d = Math.hypot(m.x - sj.x, m.z - sj.z); if (d < bd) { bd = d; bs = m; } }
        tx = bs.x; tz = bs.z; label = tr('tgt_spot'); text = (S.mode === 'car' || bd > 150) ? tr('mobj_drive') : tr('mobj_mirror', { n: S.mirrors.placed });
      } else if (!S.tower.fixed) { tx = TOWER.x; tz = TOWER.z; label = tr('tgt_tower'); text = tr('mobj_tower'); }
      else return { text: tr('f_tower'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_lab') };
      if (S.mode === 'foot' && Math.hypot(f.x - tx, f.z - tz) > 150 && distTo(c, f.x, f.z) < Math.hypot(f.x - tx, f.z - tz)) return { text: tr('obj_getRover'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
      return { text, tx, tz, label };
    }
    const farFromLab = Math.hypot(f.x, f.z) > 60;
    if (S.mode === 'car') {
      if (!S.inLab && S.o2Line > 0 && S.o2 < S.o2Line + 8) return { text: tr('obj_home'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_lab') };
      if (carrying > 0) return { text: tr('obj_return'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_lab') };
      const s = nearestSite(c.x, c.z);
      return { text: tr('obj_drive'), tx: s.x, tz: s.z, label: tr('site') + ' ' + s.name };
    }
    if (!S.inLab && S.o2Line > 0 && S.o2 < S.o2Line + 8) {
      if (S.mode === 'foot' && S.homeViaRover) return { text: tr('obj_home'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
      return { text: tr('obj_home'), tx: DOOR.x, tz: DOOR.z, label: tr('tgt_lab') };
    }
    const nr = nearestRock(f.x, f.z);
    if (nr && nr.d < 120 && S.carried < CAP_FOOT) return { text: tr('obj_collect'), tx: nr.r.x, tz: nr.r.z, label: tr('tgt_rock') };
    if (S.carried > 0 && roverAtBase() && Math.hypot(f.x, f.z) < 40) return { text: tr('obj_store'), tx: STORE.x, tz: STORE.z, label: tr('tgt_lab') };
    if (S.carried > 0) return { text: tr('obj_load'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
    if (nr && nr.d < 260) return { text: tr('obj_collect'), tx: nr.r.x, tz: nr.r.z, label: tr('tgt_rock') };
    if (S.cargo > 0) {
      if (roverAtBase()) return { text: tr('obj_store'), tx: STORE.x, tz: STORE.z, label: tr('tgt_lab') };
      return { text: tr('obj_walkRover'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
    }
    if (!farFromLab && S.t < 3) return { text: tr('obj_exitLab'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
    return { text: tr('obj_getRover'), tx: c.x, tz: c.z, label: tr('tgt_rover') };
  }
  function nearestSite(x, z) {
    let best = SITES[0], bd = 1e9;
    for (const s of SITES) { if (s.left <= 0) continue; const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  function drawMap() {
    const w = 372, h = 186 * 2, R = S.mission ? 700 : 2200, cx = w / 2, cy = h / 2, k = (w / 2 - 6) / R;
    const s = subject();
    mctx.clearRect(0, 0, w, h);
    mctx.save(); mctx.beginPath(); mctx.arc(cx, cy, cx - 2, 0, 7); mctx.clip();
    mctx.fillStyle = '#2A2226'; mctx.fillRect(0, 0, w, h);
    // north-up map: +x right, +z up
    const mx = x => cx + (x - s.x) * k, mz = z => cy - (z - s.z) * k;
    // world border
    mctx.strokeStyle = 'rgba(255,120,100,.7)'; mctx.lineWidth = 2;
    mctx.strokeRect(mx(-WORLD), mz(WORLD), 2 * WORLD * k, 2 * WORLD * k);
    mctx.strokeStyle = 'rgba(183,206,206,.14)'; mctx.lineWidth = 1;
    for (let r = 1; r <= 3; r++) { mctx.beginPath(); mctx.arc(cx, cy, (cx - 6) * r / 3, 0, 7); mctx.stroke(); }
    mctx.beginPath(); mctx.moveTo(cx, 4); mctx.lineTo(cx, h - 4); mctx.moveTo(4, cy); mctx.lineTo(w - 4, cy); mctx.stroke();
    // sites
    if (S.mission) {
      mctx.beginPath(); mctx.arc(mx(TOWER.x), mz(TOWER.z), SHADOW.R * k, 0, 7); mctx.fillStyle = 'rgba(38,29,34,.8)'; mctx.fill(); mctx.strokeStyle = '#FF8A6A'; mctx.lineWidth = 2; mctx.stroke();
      MIR_SPOTS.forEach(m => { mctx.fillStyle = m.placed ? '#6EE7A0' : '#FFD877'; mctx.fillRect(mx(m.x) - 3, mz(m.z) - 3, 6, 6); });
      mctx.fillStyle = S.tower.fixed ? '#6EE7A0' : '#FF6A4D'; mctx.beginPath(); mctx.arc(mx(TOWER.x), mz(TOWER.z), 4, 0, 7); mctx.fill();
    } else if (!S.storm.on) SITES.forEach(si => {
      mctx.beginPath(); mctx.arc(mx(si.x), mz(si.z), Math.max(5, si.R * k), 0, 7);
      mctx.fillStyle = si.left > 0 ? 'rgba(255,200,90,.28)' : 'rgba(150,160,175,.18)'; mctx.fill();
      mctx.strokeStyle = si.left > 0 ? '#FFC65A' : '#7D8794'; mctx.lineWidth = 2; mctx.stroke();
    });
    // lab
    mctx.fillStyle = '#B7CECE'; mctx.fillRect(mx(0) - 7, mz(0) - 7, 14, 14);
    mctx.strokeStyle = 'rgba(183,206,206,.5)'; mctx.beginPath(); mctx.arc(mx(0), mz(0), LAB_RADIUS * k + 3, 0, 7); mctx.stroke();
    // rover
    if (S.mode === 'foot') { mctx.fillStyle = '#FF9A4D'; mctx.fillRect(mx(S.car.x) - 5, mz(S.car.z) - 5, 10, 10); }
    // player
    mctx.translate(cx, cy); mctx.rotate(Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)));
    mctx.fillStyle = '#FFFFFF'; mctx.beginPath(); mctx.moveTo(0, -11); mctx.lineTo(8, 9); mctx.lineTo(0, 4); mctx.lineTo(-8, 9); mctx.closePath(); mctx.fill();
    mctx.restore();
    mctx.fillStyle = '#E2E2E2'; mctx.font = 'bold 18px sans-serif'; mctx.textAlign = 'center'; mctx.fillText('N', cx, 20);
  }
  const carInLabNow = () => Math.hypot(S.car.x, S.car.z) < LAB_RADIUS;
  const fmtT = v => (v > 0.5 ? '+' : v < -0.5 ? '−' : '') + Math.abs(Math.round(v)) + ' °C';
  const pad2 = n => String(n).padStart(2, '0');
  const towerPct = () => clamp((S.tower.prog + (S.action && S.action.type === 'repair' ? S.action.t : 0)) / TOWER_WORK * 100, 0, 100);
  function updateHud() {
    const vals = { health: S.hp, oxygen: S.o2, tank: S.tank, energy: S.en, rover: S.rv, radiation: S.rad };
    BARS.forEach(([k]) => {
      const v = vals[k], b = bar[k];
      dset(b.f, 'width', (Math.round(v * 2) / 2) + '%');
      let txt = Math.round(v) + '%';
      if (k === 'radiation') txt += ' · ' + tr('st_' + ['ok', 'fatigue', 'illness', 'injury'][radStage()]);
      if (k === 'oxygen') {
        if (S.refilling) txt += ' · ▲';
        else if (S.o2Rate > 0) { const sec = Math.floor(S.o2 / S.o2Rate); txt += ' · ' + Math.floor(sec / 60) + ':' + pad2(sec % 60); }
      }
      if (k === 'tank' && S.makerQ > 0) txt += ' · ▲';
      dset(b.v, 'text', txt);
      b.row.classList.toggle('low', k === 'radiation' ? v >= 55 : k === 'oxygen' ? (v < 22 || (S.o2Line > 0 && v < S.o2Line + 5)) : v < 22);
    });
    {
      const ox = bar.oxygen, on = S.o2Line > 0.5 && !S.inLab;
      dset(ox.mk, 'display', on ? 'block' : 'none'); dset(ox.home, 'display', on ? 'block' : 'none');
      if (on) {
        dset(ox.mk, 'left', S.o2Line.toFixed(1) + '%'); dset(ox.mk, 'background', S.o2 < S.o2Line ? '#FF6F6F' : '#ffffff');
        dset(ox.home, 'text', tr('o2home', { n: Math.ceil(S.o2Line) })); dset(ox.home, 'color', S.o2 < S.o2Line + 10 ? '#FF9D8A' : '#BBBAC6');
      }
      dset(inv, 'top', (stats.offsetTop + stats.offsetHeight + 12) + 'px');
    }
    if (S.storm.on) {
      const pct = i => Math.round(S.storm.valves[i] / VALVE_TIME * 100);
      dset(inv, 'html', tr('walls') + ' <b>' + pct(0) + '% · ' + pct(1) + '%</b><br>' + tr('money') + ' <b>$' + Math.floor(S.money) + '</b>');
    } else if (S.mission) {
      dset(inv, 'html', tr('money') + ' <b>$' + Math.floor(S.money) + '</b><br>' + tr('mirrors') + ' <b>' + S.mirrors.placed + ' / 3 ' + tr('placed') + '</b><br>' + tr('mirrors') + ' <b>' + S.mirrors.pack + ' ' + tr('in_pack') + '</b><br>' + tr('tower') + ' <b>' + Math.round(towerPct()) + '%</b>');
    } else {
      dset(inv, 'html', tr('money') + ' <b>$' + Math.floor(S.money) + '</b><br>' + tr('maker') + ' <b>' + (S.makerQ > 0 ? tr('heating', { n: Math.ceil(S.makerQ / ROCK_O2 - 1e-6) }) : tr('idle')) + '</b><br>' + tr('rocks') + ' <b>' + S.delivered + '</b><br>' + tr('carrying') + ' <b>' + S.carried + ' / ' + CAP_FOOT + '</b><br>' + tr('cargo') + ' <b>' + S.cargo + ' / ' + CAP_CARGO + '</b>');
    }
    // clock and temperature
    const hrs = S.clock * 24, hh = Math.floor(hrs), mm = Math.floor((hrs - hh) * 60);
    dset(envClk, 'text', pad2(hh) + ':' + pad2(mm));
    dset(envPh, 'text', tr(sunSin > 0.15 ? 'ph_day' : sunSin < -0.06 ? 'ph_night' : S.clock < 0.5 ? 'ph_dawn' : 'ph_dusk'));
    dset(envAn, 'text', tr('t_out')); dset(envUn, 'text', tr('t_suit'));
    dset(envAv, 'text', fmtT(S.amb)); dset(envUv, 'text', fmtT(S.suit));
    dset(envAv, 'color', S.amb > 60 ? '#ffb27a' : S.amb < -20 ? '#8fd0ff' : '#eef4ff');
    const sc = S.suit < 2 ? '#7fb8ff' : S.suit > 44 ? '#ff7a5c' : '#6ee7a0';
    dset(envUv, 'color', sc); dset(envBar, 'background', sc); dset(envBar, 'width', Math.round(clamp((S.suit + 50) / 110 * 100, 0, 100)) + '%');
    const o = objective(); dset(objB, 'text', o.text);
    if (S.storm.on) { const fill = (S.storm.valves[0] + S.storm.valves[1]) / (2 * VALVE_TIME) * 100; dset(objS, 'text', tr('walls') + ': ' + Math.round(fill) + '%'); dset(objP, 'width', fill + '%'); }
    else if (S.mission) { dset(objS, 'text', tr('tower') + ': ' + Math.round(towerPct()) + '%'); dset(objP, 'width', towerPct() + '%'); }
    else { dset(objS, 'text', tr('obj_fill', { n: Math.floor(S.tank) })); dset(objP, 'width', Math.floor(S.tank) + '%'); }
    const s = subject();
    dset(spB, 'text', String(Math.round(Math.abs(S.mode === 'car' ? S.car.v : S.foot.speed) * 3.6))); dset(spU, 'text', tr('kmh'));
    const dx = o.tx - s.x, dz = o.tz - s.z, d = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, dz), rel = angDiff(S.cam.yaw, bearing);
    dset(arrow, 'transform', 'rotate(' + Math.round(-rel * 180 / Math.PI) + 'deg)');
    dset(tgtB, 'text', o.label); dset(tgtS, 'text', d >= 1000 ? (d / 1000).toFixed(2) + ' km' : Math.round(d) + ' m');
    // prompt / action
    const ctx = context();
    if (S.storm.on && S.storm.pumping >= 0) {
      const i = S.storm.pumping;
      dset(action, 'display', 'block'); dset(actT, 'text', tr('a_valve', { n: i + 1 })); dset(actP, 'width', (S.storm.valves[i] / VALVE_TIME * 100) + '%'); dset(prompt, 'display', 'none');
    } else if (S.action) {
      dset(action, 'display', 'block'); dset(actT, 'text', S.action.text);
      dset(actP, 'width', (S.action.type === 'repair' ? towerPct() : S.action.t / S.action.dur * 100) + '%'); dset(prompt, 'display', 'none');
    } else {
      dset(action, 'display', 'none');
      if (ctx) { dset(prompt, 'html', ctx.text.replace(/E/, '<kbd>E</kbd>')); dset(prompt, 'display', 'block'); } else dset(prompt, 'display', 'none');
    }
    // warnings
    let w = '', red = false;
    const fl = S.flare;
    if (fl.on) { w = tr('w_flare'); red = true; }
    else if (performance.now() < S.hitUntil) { w = tr('w_hit', { d: S.lastDmg }); red = true; }
    else if (!S.inLab && S.o2Line > 0 && S.o2 < S.o2Line && S.o2 > 0) { w = tr('w_turn', { a: Math.round(S.o2), b: Math.ceil(S.o2Line) }); red = true; }
    else if (S.tankOn && S.tank < 1 && (S.inLab || S.o2 < 70)) { w = tr('w_tank0'); red = true; }
    else if (fl.warn) w = tr('w_flareSoon', { s: Math.max(1, Math.ceil(fl.next)) });
    else if (S.suit < 2 && !S.inLab) { w = tr('w_cold'); red = true; }
    else if (S.suit > 44 && !S.inLab) { w = tr('w_hot'); red = true; }
    else if (S.o2 < 20 && !S.inLab) { w = tr('w_o2'); red = true; }
    else if (S.en <= 0 && S.mode === 'car') { w = tr('w_en'); red = true; }
    else if (S.rad >= 55 && !S.inLab) { w = tr('w_rad'); red = true; }
    else if (S.rv < 25 && S.mode === 'car' && !carInLabNow()) { w = tr(S.rv <= 0 ? 'w_rv0' : 'w_rv1'); red = true; }
    else if (!S.inLab && S.o2Line > 0 && S.o2 < S.o2Line + 10) w = tr('w_soon');
    else if (S.tankOn && S.tank < 12) w = tr('w_tankLow');
    else if (S.mission && !S.sunlit && S.mirrors.placed < 2 && !S.inLab && S.mode === 'foot') w = tr('w_dark');
    else if (Math.max(Math.abs(s.x), Math.abs(s.z)) > WORLD - 250) { w = tr('w_edge'); }
    dset(warn, 'display', w ? 'block' : 'none'); dset(warn, 'text', w); warn.classList.toggle('red', red);
    const refilling = S.inLab && S.refilling && !w;
    dset(msg, 'display', refilling ? 'block' : 'none'); dset(msg, 'text', tr('m_refill'));
    // paid services prompt
    const lines = [];
    if (nearMed() && S.hp < 99.5) lines.push(S.svc.heal ? tr('s_healing') : tr('s_heal', { c: '$' + Math.ceil((100 - S.hp) * HEAL_COST) }));
    if (nearWorkshop() && roverAtBase() && S.rv < 99.5) lines.push(S.svc.repair ? tr('s_repairing') : tr('s_repair', { c: '$' + Math.ceil((100 - S.rv) * REPAIR_COST) }));
    dset(svc, 'html', lines.map(l => '<div>' + l + '</div>').join('')); dset(svc, 'display', lines.length && !S.action ? 'block' : 'none');
    if (S.storm.on) {
      const st = S.storm, show = st.phase !== 'calm' && !S.over;
      dset(stormEl, 'display', show ? 'block' : 'none');
      if (show) {
        const safe = st.shielded, cls = 'mg-storm mg-glass' + (st.phase === 'hit' ? (safe ? ' safe' : ' hit') : (safe ? ' safe' : ''));
        if (stormEl.className !== cls) stormEl.className = cls;
        const sec = Math.ceil(st.timer);
        dset(stormB, 'text', '☢ ' + (st.phase === 'warn' ? tr('st_warnT') + ' — ' + tr('storm_in') + ' 0:' + pad2(sec) : tr('st_hitT')));
        dset(stormS, 'text', safe ? tr('st_safe') : tr('st_msg'));
      }
    }
    dset(viewTag, 'opacity', performance.now() < S.viewUntil ? '1' : '0');
    dset(vig, 'opacity', fl.on ? String(Math.round((0.55 + 0.25 * Math.sin(S.t * 6)) * 20) / 20) : '0');
    S.hurtT = Math.max(0, S.hurtT - 0.1); dset(hurt, 'opacity', S.hurtT > 0 ? String(Math.round(Math.min(1, S.hurtT * 3) * 10) / 10) : '0');
  }

  // ---------- loop
  let last = performance.now(), px0 = 1e9, pz0 = 1e9, ema = 16, resT = 2, goodRuns = 0;
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const raw = now - last, dt = Math.min(0.05, raw / 1000); last = now;
    if (!S.paused && !S.over) update(dt);
    poseCharacters(dt);
    if (!S.paused) { updateDust(dt); earth.rotation.y += dt * 0.16; clouds.rotation.y += dt * 0.21; }
    if (S.storm.on) {
      const on = S.storm.exposed && !S.over;
      stat.style.opacity = on ? (0.42 + Math.random() * 0.25).toFixed(2) : '0';
      if (on) stat.style.backgroundPosition = Math.floor(Math.random() * 160) + 'px ' + Math.floor(Math.random() * 160) + 'px';
    }
    const s = subject();
    if (Math.floor(s.x / CS) !== Math.floor(px0 / CS) || Math.floor(s.z / CS) !== Math.floor(pz0 / CS)) { planChunks(s.x, s.z, false); px0 = s.x; pz0 = s.z; }
    processQueue(3.5);
    updateCamera(dt);
    hudT -= dt; if (hudT <= 0) { hudT = S.paused ? 0.3 : 0.1; updateHud(); }
    mapT -= dt; if (mapT <= 0) { mapT = S.paused ? 0.5 : 0.22; drawMap(); }
    // adaptive resolution: keep the game smooth on slow GPUs, sharpen again when there is headroom
    if (!S.paused && raw < 250) {
      ema += (raw - ema) * 0.08; resT -= raw / 1000;
      if (resT <= 0) {
        resT = 1.6;
        if (ema > 24 && pr > PR_MIN + 0.01) { pr = Math.max(PR_MIN, pr * 0.85); onResize(); goodRuns = 0; }
        else if (ema < 15.5 && pr < PR_MAX - 0.01) { if (++goodRuns >= 4) { pr = Math.min(PR_MAX, pr * 1.12); onResize(); goodRuns = 0; } }
        else goodRuns = 0;
      }
    }
    renderer.render(scene, camera);
  }

  // ---------- boot
  applyDom();
  ovHelp.style.display = 'none';
  onResize();
  load.style.display = 'flex';
  S.cam.yaw = S.foot.yaw; S.cam.x = S.foot.x; S.cam.z = S.foot.z - 8;
  updateSun(); S.amb = S.mission ? T_DAY : T_NIGHT + (T_DAY - T_NIGHT) * smooth(-0.02, 0.5, sunSin);
  if (MISSION) env.querySelector('.clk').style.display = 'none';
  setTimeout(() => {
    if (destroyed) return;
    planChunks(S.foot.x, S.foot.z, true); px0 = S.foot.x; pz0 = S.foot.z;
    if (opts.contrast && opts.contrast !== 1) canvas.style.filter = 'contrast(' + opts.contrast + ')';
    load.style.display = 'none';
    ovHelp.style.display = 'flex'; startBriefing();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }, 60);

  // ---------- API
  return {
    setLang(l) { if (T[l]) { lang = l; const helpOpen = ovHelp.style.display === 'flex', pauseOpen = ovPause.style.display === 'flex'; stopSpeech(); applyDom(); ovMap.style.display = mapOpen ? 'flex' : 'none'; ovHelp.style.display = helpOpen ? 'flex' : 'none'; ovPause.style.display = pauseOpen ? 'flex' : 'none'; if (helpOpen) startBriefing(); } },
    setVolume(v) { sfx.setVolume(v); voiceVol = v; },
    setContrast(c) { canvas.style.filter = c === 1 ? '' : 'contrast(' + c + ')'; },
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); stopSpeech();
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize); window.removeEventListener('blur', onBlur);
      for (const [, c] of chunks) removeChunk(c); chunks.clear();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      Object.values(M).forEach(m => m.dispose()); mis.mats.forEach(m => m.dispose()); shel.mats.forEach(m => m.dispose()); SHELTER.on = false; terrainMat.dispose(); detailTex.dispose(); earthTex.dispose(); cloudTex.dispose(); discTex.dispose(); SHADOW.on = false;
      sfx.close(); renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      container.innerHTML = '';
    },
    _debug: { S, rover, astro, lab, camera, scene, renderer, SITES, rocks, update, frame, mis, sunDir, sunLight, earth, MIR_SPOTS, heightAt, sunBlocked, qStat, queueLen: () => queue.length, pr: () => pr, planChunks, clouds, earthGlow }
  };
}

window.MoonGame = {
  start, stop,
  isRunning: () => !!G,
  setLang: l => { if (G) G.setLang(l); },
  setVolume: v => { if (G) G.setVolume(v); },
  setContrast: c => { if (G) G.setContrast(c); },
  _g: () => G
};
