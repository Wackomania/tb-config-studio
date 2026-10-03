'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const specs = { TBDynamicTrader: require('./_spec_dt'), TBCarDealer: require('./_spec_cd'), TBSecondHandMarket: require('./_spec_shm') };
const meta = {
  TBDynamicTrader: { name: 'TB Dynamic Trader', summary: 'Adds traders where players buy and sell items. Prices can move with stock, traders can be machines or NPCs, may relocate, and can have protected zones around them. It can also give players reputation points.', coverage: 'in-depth', docs: 'https://doc.themodbase.com/DynamicTrader/Readme.html', sources: ['DynamicTrader/Readme', 'DynamicTrader/Configs/DealerPoint', 'DynamicTrader/Configs/DealerPoints', 'DynamicTrader/Configs/Logger', 'DynamicTrader/Configs/SafeZoneCleanUp', 'DynamicTrader/Configs/TraderItemConfigs', 'DynamicTrader/Configs/TraderItemCategorieOrder', 'DynamicTrader/Configs/BetterVendingMaschines', 'DynamicTrader/Converter/Converter', 'GlobalConfigs/ReputationSystem/Index'], notes: 'Run the server once so the mod writes its files, stop it, edit, then start. Never edit the managed fields (format version, current position, next move time, stock record).' },
  TBCarDealer: { name: 'TB Car Dealer', summary: 'A vehicle dealership. Players browse a showroom, buy vehicles, sell their own and can test drive models. Prices and variants come from car and price item files.', coverage: 'in-depth', docs: 'https://doc.themodbase.com/TBCarDealer/Readme.html', sources: ['TBCarDealer/Readme', 'TBCarDealer/Configs/CarConfigs', 'TBCarDealer/Configs/DealerPointConfig', 'TBCarDealer/Configs/DealerPointsConfig', 'TBCarDealer/Configs/CarCategorieOrder', 'TBCarDealer/Configs/Logger', 'TBCarDealer/Configs/PriceItems', 'TBCarDealer/ConfigEditor/Readme'] },
  TBSecondHandMarket: { name: 'TB Second Hand Market', summary: 'A player-run market. Players place stalls, list offers and orders and trade items and vehicles with each other, with a bulletin board, global stalls and premium perks.', coverage: 'in-depth', docs: 'https://doc.themodbase.com/TBSecondHandMarket/Readme.html', sources: ['TBSecondHandMarket/Readme', 'TBSecondHandMarket/Configs/BulletinBoard', 'TBSecondHandMarket/Configs/DealerPoints', 'TBSecondHandMarket/Configs/GeneralConfig', 'TBSecondHandMarket/Configs/GlobalStallConfig', 'TBSecondHandMarket/Configs/ItemBlackList', 'TBSecondHandMarket/Configs/ItemPriceConfig', 'TBSecondHandMarket/Configs/ItemsCategory', 'TBSecondHandMarket/Configs/ItemWhiteList', 'TBSecondHandMarket/Configs/Logger', 'TBSecondHandMarket/Configs/StallConfig'], notes: 'The documentation page for the item whitelist reads like a copy of the blacklist page; its behaviour is unverified.' },
};
const ft = {
  TBDynamicTrader: { dealerpoints: ['DealerPoints list', 'Names of all traders on the server.'], 'dealerpoints-files': ['Trader (one file per trader)', 'Settings of one trader: where it stands, sounds, opening hours, safe zone and which items it sells.'], logger: ['Transaction logging', 'Where purchases and sales are logged (CSV and Discord).'], safezonecleanup: ['Safe zone clean-up whitelist', 'Items that safe-zone clean-up must leave alone.'], traderitemcategorieorder: ['Category order', 'Order of item categories at each trader.'], 'traderitemconfigs-files': ['Trade item (one file per item)', 'Price, stock and reputation rules of one item.'] },
  TBCarDealer: { carcategorieorder: ['Category order', 'Order of vehicle categories at each dealer.'], 'carconfigs-files': ['Car (one file per car)', 'A car with its variants, category, test drive and reputation rules.'], dealerpoints: ['Dealer list', 'Dealers that exist and where the first showroom is built.'], 'dealerpoints-files': ['Dealer (one file per dealer)', 'Location, permissions, spawn spots and cars of one dealer.'], logger: ['Transaction logging', 'Where car purchases and sales are logged.'], 'priceitems-files': ['Price item (one file per item)', 'Price and attachments of one car or part.'] },
  TBSecondHandMarket: { bulletinboard: ['Bulletin board', 'Navigation and posting prices of the board.'], dealerpoints: ['Global stalls', 'Placement of the shared global market stalls.'], generalconfig: ['General settings', 'Premium switch, vehicle search distance and item condition limit.'], globalstallconfig: ['Global stall rules', 'Slots, prices, lifetimes and taxes at global stalls.'], itemblacklist: ['Item blacklist', 'Items that cannot be traded.'], itempriceconfig: ['Price caps', 'Highest price allowed for items.'], itemscategory: ['Item categories', 'Categories used to filter listings.'], itemwhitelist: ['Item whitelist', 'Optional list of allowed items.'], logger: ['Logging', 'CSV and Discord logs for market actions.'], stallconfigs: ['Player stalls', 'Stall limits, placement areas and the stall types players can buy.'] },
};
for (const mod of Object.keys(specs)) {
  const p = path.join(root, 'schemas', mod + '.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  Object.assign(d.mod, meta[mod]);
  for (const f of d.files) {
    const sp = specs[mod][f.id];
    if (!sp) throw new Error('no spec ' + mod + ' ' + f.id);
    [f.title, f.summary] = ft[mod][f.id];
    const old = f.fields; const nf = {};
    for (const k of Object.keys(old)) if (!sp[k] && !sp[k.replace('Chernogorsk', '*')]) throw new Error('missing ' + mod + ' ' + f.id + ' ' + k);
    for (const [k, v] of Object.entries(sp)) {
      const m = { ...(old[k] || {}), ...v };
      if (/Webhook/i.test(k)) delete m.default;
      nf[k] = m;
    }
    f.fields = nf;
  }
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
}
