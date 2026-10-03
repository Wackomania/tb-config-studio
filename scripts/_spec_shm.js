'use strict';
const { D, O, N, F, VER, INIT, FLAG, LIST, NUM, INT, STR, COORD, ANGLE, hook } = require('./_gen_helpers');

const area = (b) => ({
  [b]: LIST(b === 'whitelistAreas' ? 'Whitelist areas' : 'Blacklist areas', b === 'whitelistAreas' ? 'Circular areas where stalls may be placed.' : 'Circular areas where stalls may not be placed.'),
  [b + '[].name']: STR('Area name', 'Name of the area.'),
  [b + '[].position']: LIST('Area position', 'Centre of the area [X, Y, Z].', { level: 'advanced' }),
  [b + '[].position[]']: { ...COORD },
  [b + '[].radius']: INT('Area radius', 'Radius of the area.', { unit: 'metres', min: 0 }),
});
const sh = {};
sh.bulletinboard = {
  version: VER(), isInitialized: INIT,
  enableNavigation: FLAG('Allow navigation to stalls', 'Lets players start navigation to a market stall from the bulletin board.'),
  showMapForMarketStallPositions: FLAG('Show stall map', 'Shows a map of stall positions on the bulletin board.'),
  maxNavigationDistance: INT('Max navigation distance', 'Greatest distance a player can navigate to a stall. -1 means any distance.', { unit: 'metres', min: -1, special: { '-1': 'unlimited' } }),
  priceForPublishOnBulletinBoard: INT('Price to publish', 'Cost for a normal player to post an offer on the board. -1 makes it free.', { unit: 'coins', min: -1, special: { '-1': 'free' } }),
  premiumPriceForPublishOnBulletinBoard: INT('Premium price to publish', 'Cost for a premium player to post an offer. -1 makes it free.', { unit: 'coins', min: -1, special: { '-1': 'free' } }),
};
sh.dealerpoints = {
  version: VER(), isInitialized: INIT,
  dealerPoints: LIST('Global stalls', 'The global market stalls placed in the world, shared by all players.'),
  'dealerPoints[].id': STR('Storage id', 'Id of the stall storage. Stalls with the same id share one storage.', { level: 'advanced' }),
  'dealerPoints[].position': LIST('Position', 'World position [X, Y, Z] of the global stall.', { level: 'advanced' }),
  'dealerPoints[].position[]': { ...COORD },
  'dealerPoints[].orientation': LIST('Orientation', 'Facing of the stall as three angles in degrees.', { level: 'advanced' }),
  'dealerPoints[].orientation[]': { ...ANGLE },
  'dealerPoints[].useExactPosition': FLAG('Use exact position', '0 places the stall on the ground below; 1 uses the coordinates as given.', { level: 'advanced' }),
  'dealerPoints[].type': STR('Stall object', 'Class name of the stall object.', { type: 'classname', level: 'advanced' }),
  'dealerPoints[].uniqueName': STR('Stall name', 'Name for this stall, used in admin tools and lists.'),
  'dealerPoints[].disableVehicleTrading': FLAG('Block vehicle trading', '1 stops normal players trading vehicles at this stall.'),
  'dealerPoints[].premiumDisableVehicleTrading': FLAG('Block vehicle trading (premium)', '1 stops premium players trading vehicles at this stall.'),
};
sh.generalconfig = {
  version: VER(), isInitialized: INIT,
  enablePremiumFeature: FLAG('Premium features', 'Turns premium player features (bigger limits, lower prices) on or off.'),
  maxSearchDistanceToVehicle: NUM('Vehicle search distance', 'How far from the stall a vehicle may be when ordering vehicle items.', { unit: 'metres', min: 0 }),
  minOrderHealthValue: STR('Minimum item condition', 'Worst condition an item can have in an order. Values run from Pristine through Worn and Damaged to BadlyDamaged and Ruined. Write them as in the existing file (the documentation spells one as "Badly Damaged"; the generated file uses BadlyDamaged).', { typical: 'Worn, Damaged, BadlyDamaged' }),
};
sh.globalstallconfig = {
  version: VER(), isInitialized: INIT,
  pricePerSlot: INT('Price per slot', 'What a player pays per slot used at the global stall. See the percentage switch.', { min: 0, unit: 'coins or percent' }),
  pricePerSlotIsInPercentage: FLAG('Slot price is a percentage', '1 reads the slot price as a percentage instead of coins.'),
  pricePerSlotPremiumPlayer: INT('Premium price per slot', 'Slot price for premium players.', { min: 0, unit: 'coins or percent' }),
  pricePerSlotPremiumPlayerIsInPercentage: FLAG('Premium slot price is a percentage', '1 reads the premium slot price as a percentage.'),
  freeSlotsForPlayer: INT('Free slots', 'Slots a normal player gets without paying.', { min: 0 }),
  maxSlotsForPlayer: INT('Max slots', 'Most slots a normal player can have across all global stalls.', { min: 0 }),
  freeSlotsForPremiumPlayer: INT('Free slots (premium)', 'Slots a premium player gets without paying.', { min: 0 }),
  maxSlotsForPremiumPlayer: INT('Max slots (premium)', 'Most slots a premium player can have.', { min: 0 }),
  maxOrderLifetimeInMinutes: INT('Order lifetime', 'How long an order stays active after creation.', { unit: 'minutes', min: 0, typical: '10080 (one week)' }),
  maxOrderLifetimeInMinutesPremiumPlayers: INT('Order lifetime (premium)', 'Order lifetime for premium players.', { unit: 'minutes', min: 0 }),
  maxOfferLifetimeInMinutes: INT('Offer lifetime', 'How long an offer stays active after creation.', { unit: 'minutes', min: 0, typical: '10080 (one week)' }),
  maxOfferLifetimeInMinutesPremiumPlayers: INT('Offer lifetime (premium)', 'Offer lifetime for premium players.', { unit: 'minutes', min: 0 }),
  sellTaxInPercentageOrder: INT('Tax on orders', 'Percent the seller pays when filling an order at a global stall. A coin sink.', { unit: 'percent', min: 0, max: 100 }),
  sellTaxInPercentageOffer: INT('Tax on offers', 'Percent paid when an offer is completed.', { unit: 'percent', min: 0, max: 100 }),
  resetLifetimeOfOrderAfterUpdate: FLAG('Reset order lifetime on update', 'Updating an order restarts its lifetime.'),
  canResetLifetimeOfOrder: FLAG('Players may reset order lifetime', 'Lets players restart the order timer by hand.'),
  canResetLifetimeOfOffer: FLAG('Players may reset offer lifetime', 'Lets players restart the offer timer by hand.'),
};
sh.itemblacklist = {
  version: VER(), isInitialized: INIT,
  blackListItems: LIST('Blocked items', 'Items that cannot be traded or ordered. Patterns work: exact name, Start*, *End and *part*.'),
  'blackListItems[]': STR('Blocked item', 'One class name or pattern, for example Zmb* for all zombies.'),
};
sh.itempriceconfig = {
  version: VER(), isInitialized: INIT,
  generalMaxPrice: INT('Global price cap', 'Highest price allowed for any item. -1 means no cap. Items in the list below use their own cap.', { unit: 'coins', min: -1, special: { '-1': 'no cap' } }),
  itemMaxPrices: LIST('Per-item price caps', 'Price caps for single items; they override the global cap.'),
  'itemMaxPrices[].itemType': STR('Item class', 'Class name of the item the cap applies to.', { type: 'classname' }),
  'itemMaxPrices[].maxPrice': INT('Price cap', 'Highest price allowed for this item.', { unit: 'coins', min: 0 }),
};
sh.itemscategory = {
  version: VER(), isInitialized: INIT,
  categories: LIST('Categories', 'Item categories used to filter the board and global stall lists.'),
  'categories[].name': STR('Category name', 'Name shown to players.'),
  'categories[].items': LIST('Items in category', 'Class names that belong to this category.'),
  'categories[].items[]': STR('Item class', 'One item class name.', { type: 'classname' }),
};
sh.itemwhitelist = {
  version: VER(), isInitialized: INIT,
  IsEnabled: FLAG('Whitelist active', 'When 1, the whitelist is used. Judging by the file layout only listed items can then be traded; the documentation page is ambiguous (it describes the list as blocking), so test on a copy first.', { confidence: N, risk: 'If it acts as an allow list, an empty or wrong list blocks all trading.' }),
  whiteListItems: LIST('Allowed items', 'Class names or patterns (Start*, *End, *part*) of items on the whitelist.', { confidence: O }),
  'whiteListItems[]': STR('Item name', 'One class name or pattern.', { confidence: O }),
};
const lg = {};
for (const [k, label, what] of [['BuyStall', 'a stall is bought', 'stall purchases'], ['PlaceStall', 'a stall is placed', 'stall placements'], ['RemoveStall', 'a stall is removed', 'stall removals'], ['AddOffer', 'an offer is added', 'new offers'], ['RemoveOffer', 'an offer is removed', 'offer removals'], ['AcceptOffer', 'an offer is accepted', 'accepted offers'], ['AddOrder', 'an order is created', 'new orders'], ['RemoveOrder', 'an order is removed', 'order removals'], ['AcceptOrder', 'an order is accepted', 'accepted orders'], ['GetItemFromOrder', 'an item is taken from an order', 'items taken from orders'], ['DeleteItem', 'an item is deleted', 'item deletions'], ['AddMoney', 'money is added to a stall', 'money deposits'], ['RemoveMoney', 'money is taken from a stall', 'money withdrawals']]) {
  lg['log' + k + 'CSV'] = FLAG('CSV log: ' + what, 'Writes a line to a CSV file whenever ' + label + '.');
  lg['log' + k + 'Discord'] = FLAG('Discord log: ' + what, 'Posts a message whenever ' + label + ', to the address below.');
  lg['discord' + k + 'WebhookURL'] = hook(what);
}
sh.logger = { version: VER(), ...lg };
sh.stallconfigs = {
  version: VER(), isInitialized: INIT,
  maxMarketStallPerUser: INT('Stalls per player', 'Most stalls one player can have. -1 means unlimited.', { min: -1, special: { '-1': 'unlimited' } }),
  maxPremiumMarketStallPerUser: INT('Stalls per premium player', 'Most stalls for a premium player. -1 means unlimited.', { min: -1, special: { '-1': 'unlimited' } }),
  maxMarketStallPerServer: INT('Stalls on the server', 'Most stalls on the whole server. -1 means unlimited.', { min: -1, special: { '-1': 'unlimited' } }),
  timeInMinutesThatOwnerHasAfterLifetimeIsExpired: INT('Grace period after expiry', 'Time the owner has to collect items once a stall expires.', { unit: 'minutes', min: 0 }),
  playerCanOnlyPlaceMarketStallInWhitelistAreas: FLAG('Only place in whitelist areas', '1 limits stall placement to the whitelist areas. Do not switch on together with the blacklist option.'),
  ...area('whitelistAreas'),
  playerCanOnlyPlaceMarketStallInNonBlacklistAreas: FLAG('Block blacklist areas', '1 stops stall placement inside the blacklist areas. Do not switch on together with the whitelist option.'),
  ...area('blacklistAreas'),
  stalls: LIST('Stall types', 'The stall types players can buy and place, with their sizes, lifetimes and prices.'),
  'stalls[].id': STR('Stall id', 'Unique id for this stall type; any random text.', { level: 'advanced' }),
  'stalls[].type': STR('Stall kit class', 'Class name of the stall kit item.', { type: 'classname', level: 'advanced' }),
  'stalls[].slotCount': INT('Slots', 'Inventory slots of the stall.', { min: 0 }),
  'stalls[].premiumExtraSlotCount': INT('Extra slots (premium)', 'Slots added for premium players.', { min: 0 }),
  'stalls[].lifetimeInMinutes': INT('Lifetime', 'Minutes until the stall disappears.', { unit: 'minutes', min: 0 }),
  'stalls[].premiumExtraLifetimeInMinutes': INT('Extra lifetime (premium)', 'Minutes added to the lifetime for premium players.', { unit: 'minutes', min: 0 }),
  'stalls[].price': INT('Price', 'Cost to place the stall.', { unit: 'coins', min: 0 }),
  'stalls[].premiumPriceReduce': INT('Premium discount', 'Amount taken off the price for premium players.', { unit: 'coins', min: 0 }),
  'stalls[].priceForTimeExtension': INT('Extension price', 'Cost to extend the lifetime. -1 turns extensions off.', { unit: 'coins', min: -1, special: { '-1': 'off' } }),
  'stalls[].durationInMinutesForTimeExtension': INT('Extension length', 'Minutes added per extension. -1 turns extensions off.', { unit: 'minutes', min: -1, special: { '-1': 'off' } }),
  'stalls[].disableVehicleTrading': FLAG('Block vehicle trading', '1 stops normal players trading vehicles at this stall.'),
  'stalls[].premiumDisableVehicleTrading': FLAG('Block vehicle trading (premium)', '1 stops premium players trading vehicles at this stall.'),
};
module.exports = sh;
