'use strict';
const { D, O, N, F, VER, INIT, FLAG, LIST, NUM, INT, STR, COORD, ANGLE, hook } = require('./_gen_helpers');

const pt = (label, help, o) => INT(label, help, { unit: 'points', level: 'advanced', ...o });
const cdPos = (k, label, help, ang) => ({
  [k]: LIST(label, help, { level: 'advanced' }),
  [k + '[]']: { ...(ang ? ANGLE : COORD) },
});
const cd = {};
cd.carcategorieorder = {
  version: VER(),
  'categorieOrder.*': LIST('Category order of this dealer', 'Order in which vehicle categories appear at the dealer. The key is the dealer name. New categories are added automatically at reload and restart.'),
  'categorieOrder.*[]': STR('Category name', 'One category name as used in car configs.'),
};
cd['carconfigs-files'] = {
  uniqueName: STR('Car id', 'Name of this car entry. Must match the file name. Dealers refer to it by this name.', { level: 'advanced' }),
  items: LIST('Items (internal)', 'Reserved by the mod. Do not change.', { internal: true, level: 'danger' }),
  uniqueCarNames: LIST('Car variants', 'Names of price item files (PriceItems folder) that make up this car and its colour or equipment variants.'),
  'uniqueCarNames[]': STR('Variant file name', 'Name of one price item file in PriceItems.'),
  category: STR('Category', 'Group this car is shown under at the dealer.'),
  canUsedForTestDrive: FLAG('Allow test drive', 'Lets players test the car. Needs a test drive start position on the dealer point.'),
  maxDistanceToTestDriveSpawnPosition: INT('Test drive range', 'How far from the start spot the player may drive before the test ends.', { unit: 'metres', min: 0 }),
  maxTimeInSecondsForTestDrive: INT('Test drive time', 'How long a test drive lasts. It also ends when the player leaves the car or the range.', { unit: 'seconds', min: 0, typical: '120-600' }),
  enablePoints: FLAG('Use reputation', 'Switches reputation rules for this car on. When off, the limits below are ignored.'),
  minPointsNeededForBuy: pt('Minimum reputation to buy', 'Lowest reputation a player may have and still buy. The default (about minus 2.1 billion) means no lower limit.'),
  maxPointsNeededForBuy: pt('Maximum reputation to buy', 'Highest reputation a player may have and still buy. The default (about 2.1 billion) means no upper limit.'),
  minPointsNeededForSell: pt('Minimum reputation to sell', 'Lowest reputation a player may have and still sell. The default means no lower limit.'),
  maxPointsNeededForSell: pt('Maximum reputation to sell', 'Highest reputation a player may have and still sell. The default means no upper limit.'),
  givePlayerPointsForBuy: pt('Points for buying', 'Reputation points gained per purchase. Only used when reputation is enabled.'),
  givePlayerPointsForSell: pt('Points for selling', 'Reputation points gained per sale. Only used when reputation is enabled.'),
  version: VER(),
};
cd.dealerpoints = {
  version: VER(), isInitialized: INIT,
  ...cdPos('firstPositionOfShowroom', 'First showroom position', 'Where the first indoor showroom is built, normally a spot outside the playable map. Each further showroom is placed 50 metres higher.'),
  dealerPointsNames: LIST('Dealer names', 'Dealers that exist. Each name must match a file in the DealerPoints folder.'),
  'dealerPointsNames[]': STR('Dealer name', 'Name of one dealer; must match a file in DealerPoints.'),
};
cd['dealerpoints-files'] = {
  uniqueName: STR('Dealer id', 'Name of this dealer; must match the file name and the entry in DealerPoints.json.', { level: 'advanced' }),
  version: VER(),
  displayName: STR('Display name', 'Name players see for this dealer.'),
  playerCanSellCars: FLAG('Players can sell cars', 'Lets players sell their own vehicles here.'),
  playerCanEnterShowRoom: FLAG('Players can enter showroom', 'Lets players walk into the showroom to look at cars.'),
  playerCanBuyCars: FLAG('Players can buy cars', 'Lets players buy vehicles here. Turn off for a look-only dealer.'),
  acceptOnlyCash: FLAG('Cash only', '1 means only cash carried by the player counts; money in a bank or ATM is ignored.'),
  ...cdPos('position', 'Dealer position', 'World position [X, Y, Z] of the dealer machine.'),
  ...cdPos('orientation', 'Dealer orientation', 'Facing of the dealer in degrees (three angles).', true),
  useExactPosition: FLAG('Use exact position', '0 places the dealer on the ground, 1 uses the coordinates as given.', { level: 'advanced' }),
  ...cdPos('spawnPosition', 'Vehicle spawn position', 'Where a bought car appears [X, Y, Z]. Keep the spot free of buildings.'),
  ...cdPos('spawnOrientation', 'Vehicle spawn orientation', 'Direction a bought car faces when it appears.', true),
  useExactSpawnPosition: FLAG('Use exact spawn position', '1 spawns the car exactly at the spawn position; 0 searches for a nearby free space.', { level: 'advanced' }),
  ...cdPos('sellPosition', 'Inspection position', 'Where the dealer inspects a car a player wants to sell.'),
  ...cdPos('sellOrientation', 'Inspection orientation', 'Direction of the inspection spot.', true),
  ...cdPos('scanBoxToFindCarsForSell', 'Sell scan box size', 'Size [X, Y, Z] of the box searched for the player car when selling.'),
  testDriveReturnHeightOffset: NUM('Test drive return height offset', 'Height adjustment added to the spot where the player returns after a test drive.', { unit: 'metres', level: 'advanced' }),
  parkingSignType: STR('Parking sign class', 'Class name of the sign object placed at the sell spot.', { type: 'classname', level: 'advanced' }),
  spawnParkingSign: FLAG('Spawn parking sign', 'Places a parking sign at the sell inspection spot.'),
  parkingSignHeightOffset: NUM('Parking sign height offset', 'Height adjustment for the sign. Normally 1.', { unit: 'metres', level: 'advanced' }),
  type: STR('Dealer object', 'Class name of the dealer machine object.', { type: 'classname', level: 'advanced', risk: 'An unknown class means no dealer appears.' }),
  testDriveStartPosition: LIST('Test drive start spots', 'Spots where a test drive car appears; each has a position and an orientation.'),
  'testDriveStartPosition[].position': LIST('Test drive position', 'World position [X, Y, Z] of a test drive start spot.', { level: 'advanced' }),
  'testDriveStartPosition[].position[]': { ...COORD },
  'testDriveStartPosition[].orientation': LIST('Test drive orientation', 'Facing of the test drive car at this spot.', { level: 'advanced' }),
  'testDriveStartPosition[].orientation[]': { ...ANGLE },
  uniqueFileNames: LIST('Cars for sale', 'Names of car config files (CarConfigs folder) offered at this dealer.'),
  'uniqueFileNames[]': STR('Car file name', 'Name of one car config file.'),
  enableNpcTrader: FLAG('Show NPC dealer', 'Places a character next to the machine.'),
  npcType: STR('NPC class', 'Class name of the character model for the NPC dealer.', { type: 'classname' }),
  npcGearSetName: STR('NPC gear set', 'Name of the outfit for the NPC. Created if it does not exist. Empty uses default clothes.', { level: 'advanced' }),
};
cd.logger = {
  version: VER(),
  logBuyCSV: FLAG('Log buys to CSV', 'Writes every car purchase to a CSV file on the server.'),
  logBuyDiscord: FLAG('Log buys to Discord', 'Posts every car purchase to the buy webhook address.'),
  discordBuyWebhookURL: hook('car purchases'),
  logSellCSV: FLAG('Log sells to CSV', 'Writes every car sale to a CSV file.'),
  logSellDiscord: FLAG('Log sells to Discord', 'Posts every car sale to the sell webhook address.'),
  discordSellWebhookURL: hook('car sales'),
};
cd['priceitems-files'] = {
  uniqueName: STR('Item id', 'Name of this price entry; must match the file name. Car configs refer to it.', { level: 'advanced' }),
  type: STR('Item class', 'Class name of the vehicle or part, as in types.xml.', { type: 'classname' }),
  quantity: NUM('Quantity', 'Amount of the item in percent (fill level). 100 is full.', { unit: 'percent', min: 0, typical: '100' }),
  sellPrice: INT('Sell price', 'What a player would get for selling it. The documentation says this is not implemented yet.', { unit: 'coins', min: 0 }),
  givePlayerPointsForBuy: pt('Points for buying', 'Reputation points gained on purchase.'),
  currencyType: STR('Currency', 'Currency used. "default" uses the main currency from the shared currency config.', { typical: 'default' }),
  buyPrice: INT('Buy price', 'Price a player pays for this item.', { unit: 'coins', min: 0 }),
  isPremium: F('Premium only', 'Only premium players can buy this item.', { type: 'bool', confidence: D }),
  amountItem: INT('Amount per purchase', 'How many of this item are given per purchase; used mainly for optional attachments.', { min: 1, typical: '1' }),
  attachmentUniqueNames: LIST('Included attachments', 'Price item names that come with the item at no extra cost.'),
  'attachmentUniqueNames[]': STR('Attachment name', 'Name of one included price item.'),
  optionalAttachmentUniqueNames: LIST('Optional attachments', 'Price item names offered for extra money and not shown in the showroom.'),
  version: VER(),
};
module.exports = cd;
