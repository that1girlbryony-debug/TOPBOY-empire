/**
 * 🛠 src/data/animeCards.js — Phase 2 / 2.5
 * Copy of old data/animeCards.js — ~75 anime cards across 5 tiers.
 * No behavior change, just relocated into src/data/.
 *
 * Tier System:
 *   Common    → 150k–750k
 *   Rare      → 700k–1.5M
 *   Epic      → 2M–5M
 *   Legendary → 6M–12M
 *   Mythic    → 15M–25M
 */

const animeCards = [
  // ==========================
  // 🍥 NARUTO
  // ==========================
  { name: "Naruto Uzumaki", tier: "Mythic", worth: 22000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b17-phjcWCkRuIhu.png" },
  { name: "Itachi Uchiha", tier: "Mythic", worth: 20000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b14-9Kb1E5oel1ke.png" },
  { name: "Madara Uchiha", tier: "Mythic", worth: 25000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b53901-HnRKSoHMG5Vg.png" },
  { name: "Might Guy", tier: "Legendary", worth: 9000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b307-xieUEdhdTVwQ.png" },
  { name: "Hinata Hyuga", tier: "Rare", worth: 1200000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b1555-Q41GLTV3FvYF.png" },
  { name: "Deidara", tier: "Epic", worth: 3500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b1902-JsEFRFwjmtZJ.png" },
  { name: "Jiraiya", tier: "Legendary", worth: 8000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2423-RO5MyoXSA9OL.png" },
  { name: "Iruka Umino", tier: "Rare", worth: 800000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2011-WUBm7wMCA6cE.png" },
  { name: "Orochimaru", tier: "Epic", worth: 4000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n2455-V9tLMS3TIgJW.png" },
  { name: "Tsunade Senju", tier: "Epic", worth: 4500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2767-r61Cj9v8I0wl.png" },
  { name: "Tobi", tier: "Legendary", worth: 7500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b3149-j6cl8A9yup51.png" },
  { name: "Pain", tier: "Legendary", worth: 8500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b3180-ITMGBLWNBOgV.png" },
  { name: "Kakashi Hatake", tier: "Legendary", worth: 9500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b85-mkVBh2yjxjmx.png" },
  { name: "Sakura Haruno", tier: "Epic", worth: 3000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b145-IorfpI8arxeX.png" },
  { name: "Gaara", tier: "Legendary", worth: 7000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b1662-4E5J0LX9jZKZ.png" },

  // ==========================
  // 🔥 BLUE EXORCIST
  // ==========================
  { name: "Rin Okumura", tier: "Legendary", worth: 8000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b24482-E6087V4uAVqL.jpg" },
  { name: "Yukio Okumura", tier: "Epic", worth: 4000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b24734-GgVZoNAPnxoc.png" },
  { name: "Mephisto Pheles", tier: "Legendary", worth: 7000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b30432-I4KwsegOrzfq.png" },
  { name: "Ryuji Suguro", tier: "Epic", worth: 2500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b30429-NmVCBSzm3GNY.png" },
  { name: "Shirou Fujimoto", tier: "Rare", worth: 900000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b30431-l5NMqfM82w4q.png" },
  { name: "Ukobach", tier: "Common", worth: 200000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b84925-XAU47vDVmu10.png" },
  { name: "Nii-chan", tier: "Common", worth: 150000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b47527-Ms1bzAyPzCih.png" },
  { name: "Igor Neuhaus", tier: "Rare", worth: 750000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b38985-pW70uJHQONhK.png" },

  // ==========================
  // 🔥 DEMON SLAYER
  // ==========================
  { name: "Tanjiro Kamado", tier: "Legendary", worth: 10000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b126071-BTNEc1nRIv68.png" },
  { name: "Nezuko Kamado", tier: "Legendary", worth: 11000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b127518-NRlq1CQ1v1ro.png" },
  { name: "Zenitsu Agatsuma", tier: "Epic", worth: 3000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b129131-FZrQ7lSlxmEr.png" },
  { name: "Kyojuro Rengoku", tier: "Mythic", worth: 18000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b129133-VlTPowwt68rJ.png" },
  { name: "Tengen Uzui", tier: "Legendary", worth: 8500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b136071-99Kexnnn2PiV.png" },
  { name: "Sabito", tier: "Rare", worth: 800000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b137809-6Tkle99lCBl8.png" },
  { name: "Yahaba", tier: "Common", worth: 300000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b138811-V9NNgNp9dAjq.png" },
  { name: "Yushiro", tier: "Rare", worth: 700000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b138846-i8frJEl8baly.jpg" },
  { name: "Hotaru Haganezuka", tier: "Rare", worth: 750000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b138990-E5kiUoLigpyX.jpg" },
  { name: "Rui", tier: "Epic", worth: 3500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b139739-BP0eUt2P9pRv.png" },

  // ==========================
  // ⚔ ATTACK ON TITAN
  // ==========================
  { name: "Eren Yeager", tier: "Mythic", worth: 20000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b40882-dsj7IP943WFF.jpg" },
  { name: "Armin Arlert", tier: "Epic", worth: 2800000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b46494-g7xYYuBtYPnO.png" },
  { name: "Annie Leonhart", tier: "Legendary", worth: 7500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b46490-tan274Ifc1Jf.jpg" },
  { name: "Erwin Smith", tier: "Legendary", worth: 9000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b46496-Mu86MENd5wNB.png" },
  { name: "Hange Zoe", tier: "Epic", worth: 3200000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b71121-7R7CnQd3lHgt.png" },
  { name: "Reiner Braun", tier: "Legendary", worth: 7000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b46484-P6A2GjNQn49F.png" },
  { name: "Hannes", tier: "Rare", worth: 700000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b46492-5kRaMLDCVD0B.jpg" },
  { name: "Jean Kirstein", tier: "Epic", worth: 2500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b46498-ritqAj9FW6jX.png" },
  { name: "Krista Lenz", tier: "Rare", worth: 1000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b62481-ZZDa7vn17lMU.png" },
  { name: "Darius Zackly", tier: "Rare", worth: 800000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b71125-XXymqijVoYzV.png" },

  // ==========================
  // 🧠 DEATH NOTE
  // ==========================
  { name: "L Lawliet", tier: "Mythic", worth: 23000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b71-1W4panC53vfs.png" },
  { name: "Light Yagami", tier: "Mythic", worth: 22000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b80-26EhwSsSqQ50.png" },
  { name: "Nate River (Near)", tier: "Legendary", worth: 7000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n464-6KeJpU6g7Hwj.jpg" },
  { name: "Rem", tier: "Epic", worth: 4000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n1905-9GfCvLFKNRLR.png" },
  { name: "Mihael Keehl (Mello)", tier: "Epic", worth: 4000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b463-QBLeLf6XxVg6.png" },
  { name: "Misa Amane", tier: "Legendary", worth: 8000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b835-CiZa8y2z2gCz.png" },
  { name: "Reiji Namikawa", tier: "Rare", worth: 850000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n1929-TYRt1UCHOS33.png" },
  { name: "Ryuk", tier: "Legendary", worth: 10000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b75-IkEpzO21LgFy.jpg" },
  { name: "Masahiko Kida", tier: "Common", worth: 200000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n1931-kJH9pspSPKMJ.png" },
  { name: "Kiyomi Takada", tier: "Rare", worth: 1100000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n3765-XmrhzN7QO27e.png" },

  // ==========================
  // 🌀 JUJUTSU KAISEN
  // ==========================
  { name: "Megumi Fushiguro", tier: "Epic", worth: 4500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b126635-L0y3I92JSUkN.png" },
  { name: "Yuji Itadori", tier: "Legendary", worth: 9000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b127212-FVm2tD0erQ5F.png" },
  { name: "Satoru Gojo", tier: "Mythic", worth: 25000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png" },
  { name: "Sukuna", tier: "Mythic", worth: 24000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b133701-rCQuDpHr3UZL.png" },
  { name: "Suguru Geto", tier: "Legendary", worth: 7500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b133699-FCnXaISgazAi.png" },
  { name: "Junpei Yoshino", tier: "Rare", worth: 800000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b157214-ROBNoXVEXRNy.jpg" },
  { name: "Mahito", tier: "Legendary", worth: 9000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b133702-Y7JRG5vAvjIL.png" },
  { name: "Kento Nanami", tier: "Legendary", worth: 10000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b133704-8wLTGjc234q2.png" },
  { name: "Aoi Todo", tier: "Epic", worth: 5000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b137975-6TH7PiLWJaqy.png" },
  { name: "Mei Mei", tier: "Epic", worth: 4000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b157215-I3TQJu8nkDwD.jpg" },
  { name: "Nagi Yoshino", tier: "Rare", worth: 700000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b194056-yEzHVaAF9eqJ.png" },
  { name: "Naobito Zenin", tier: "Epic", worth: 3500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b188432-WePQBJsEuSts.png" },

  // ==========================
  // 🏴 ONE PIECE
  // ==========================
  { name: "Monkey D. Luffy", tier: "Mythic", worth: 25000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b40-MNypXsxSRb1R.png" },
  { name: "Nico Robin", tier: "Legendary", worth: 8000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b61-ywXUyyocEEqt.png" },
  { name: "Roronoa Zoro", tier: "Legendary", worth: 10000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b62-S7oAeA9WInjV.png" },
  { name: "Franky", tier: "Epic", worth: 4000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n64-ChX6ZzHHjXqA.png" },
  { name: "Sanji", tier: "Legendary", worth: 9000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b305-6lisPmHtCnLT.png" },
  { name: "Tony Tony Chopper", tier: "Epic", worth: 3500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b309-H64NhbJ2ywIQ.jpg" },
  { name: "Shanks", tier: "Mythic", worth: 23000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b727-wUJx7M1z5xON.png" },
  { name: "Buggy", tier: "Epic", worth: 3000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/n725-g04AaiaK5f9B.png" },
  { name: "Enel", tier: "Legendary", worth: 7500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b1541-6c8RouunoL88.jpg" },
  { name: "Jinbe", tier: "Legendary", worth: 8000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b18938-yZANEfjsVhW4.png" },
  { name: "Tashigi", tier: "Rare", worth: 900000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2750-j3Rf9SC37ehT.jpg" },
  { name: "Usopp", tier: "Epic", worth: 4000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b724-GFGgI9AJQkfy.jpg" },

  // ==========================
  // 🎓 CLASSROOM OF THE ELITE
  // ==========================
  { name: "Kiyotaka Ayanokoji", tier: "Legendary", worth: 12000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b123212-ewZgUQr9vvEM.png" },

  // ==========================
  // 🐉 DRAGON BALL
  // ==========================
  { name: "Son Goku", tier: "Mythic", worth: 25000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/246-wsRRr6z1kii8.png" },
  { name: "Vegeta", tier: "Mythic", worth: 22000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b913-NIFkKazWM8VO.png" },
  { name: "Piccolo", tier: "Legendary", worth: 9000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b914-KuS8AWjqBrqa.jpg" },
  { name: "Krillin", tier: "Epic", worth: 3500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2159-qtEuMYyOUkwY.jpg" },
  { name: "Pan", tier: "Rare", worth: 800000, image: "https://s4.anilist.co/file/anilistcdn/character/large/3168.jpg" },
  { name: "Spopovich", tier: "Rare", worth: 700000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2132-thuZprgp743F.png" },
  { name: "Cell Jr.", tier: "Epic", worth: 4500000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2145-I0zcra0II0Qd.png" },
  { name: "Sharpner", tier: "Common", worth: 150000, image: "https://s4.anilist.co/file/anilistcdn/character/large/2117.jpg" },
  { name: "Son Gohan", tier: "Legendary", worth: 11000000, image: "https://s4.anilist.co/file/anilistcdn/character/large/b2093-kdFZhqcNSsqW.png" },
  { name: "Marron", tier: "Common", worth: 200000, image: "https://s4.anilist.co/file/anilistcdn/character/large/2106.jpg" },
];

module.exports = animeCards;
