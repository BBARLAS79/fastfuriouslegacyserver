# Client Server Rebuild

Bu klasor, istemci kodlarinda gorunen native bridge sozlesmesini emule eden daha kapsamli bir Node.js sunucusudur.

## Kapsam

Sunucu su iki katmani cevaplar:

- Magazine/article bridge:
  - `POST /bridge/server-data`
  - `POST /bridge/article-data`
- Native/game function bridge:
  - `POST /bridge/game-function`
  - `POST /bridge/runqueue`

Ek olarak su endpointler aciktir:

- `GET /health`
- `GET /status`
- `GET /packs.txt`
- `GET /media/<name>.svg`
- `GET /debug/state`

## Emule edilen ana istemci methodlari

Sunucu, istemcide gorunen su alanlari kapsar:

- Sunucu durumu: `GetServerStatus`, `ValidateAgainstServerTime`, `GetBuildInfoString`
- Genel veri: `GetLocalisationDictionary`, `GetGlobalUIData`
- Profil: `GetProfile`, `GetNotifications`, `GetBadgeDescriptions`
- Kalici durum: `GetPersistentStore`, `SetPersistentStore`, `GetSessionStore`, `SetSessionStore`
- Makaleler: `GetIndividualArticleData`, `GetCachedArticles`, `GetCachedArticlesList`
- Kariyer: `GetCareerArticles`, `GetCareerArticleStructure`, `GetArticleEventData`
- Araclar: `GetVehicleDescriptions`, `GetCurrentCarInfo`, `GetCurrentCarPISS`, `GetBaseCarPISS`, `ShowroomGetBaseCarPISS`
- Magaza: `GetPurchasables`, `GetCurrentVehiclePurchasables`, `GetInAppPurchasables`, `PurchaseItem`, `GiftItem`, `PurchaseInAppItem`, `RestorePurchases`
- Tamir/yakit: `GetRepairCost`, `GetRepairTime`, `FillFuelTank`, `SpendFuel`
- Akis/no-op komutlari: `GoToGarage`, `GoToShowroom`, `RunArticle`, `SwitchCar`, `PlayUiSound` vb.

Not:

- Bu sunucu, istemciye uygun bir bridge emulasyonudur.
- Native binary protokolunu birebir tersine cevrilmis seviyede degil, istemcinin bekledigi veri seklini ureten pratik seviyede uygular.

## IP / 80 / 443 ayari

Varsayilanlar:

- `PUBLIC_HOST` verilmezse sunucu Mac'teki uygun local IPv4 adresini otomatik secer
- `HTTP_PORT=80`
- `HTTPS_PORT=443`

Dinlenecek host:

- `BIND_HOST=0.0.0.0`

HTTPS icin sertifika lazim:

- `SSL_KEY_PATH=/path/to/privkey.pem`
- `SSL_CERT_PATH=/path/to/fullchain.pem`

HTTPS sertifikalari verilmezse HTTP calisir, HTTPS log mesajiyla pas gecilir.

Ornek:

- Wi-Fi IP'n `192.168.1.141` ise client tarafinda IP olarak bunu kullan
- Zorla baska adres gostermek istersen `PUBLIC_HOST=192.168.1.141 node server.js`

## Calistirma

Lokal test icin port override et:

```bash
cd "/Users/berkeipekci/Documents/New project/client_server_rebuild"
HTTP_PORT=3187 HTTPS_PORT=3443 node server.js
```

Gercek 80/443 icin:

```bash
cd "/Users/berkeipekci/Documents/New project/client_server_rebuild"
sudo SSL_KEY_PATH=/etc/letsencrypt/live/141.11.109.193/privkey.pem \
SSL_CERT_PATH=/etc/letsencrypt/live/141.11.109.193/fullchain.pem \
node server.js
```

## Ornek istekler

```bash
curl http://127.0.0.1:3187/status
```

```bash
curl -X POST http://127.0.0.1:3187/bridge/server-data \
  -H 'Content-Type: application/json' \
  -d '{"method":"UserGetChannels","userId":"default"}'
```

```bash
curl -X POST http://127.0.0.1:3187/bridge/game-function \
  -H 'Content-Type: application/json' \
  -d '{"funcName":"GetProfile","options":{},"userId":"default"}'
```

```bash
curl -X POST http://127.0.0.1:3187/bridge/runqueue \
  -H 'Content-Type: application/json' \
  -d '{"commands":[{"commandId":1,"funcName":"GetServerStatus","options":{}},{"commandId":2,"funcName":"GetProfile","options":{}}],"userId":"default"}'
```
