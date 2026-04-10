# Full Server Build Plan

Bu oyun icin sunucu yazabiliriz.
Ama bunu saglikli yapmak icin asamalara bolmek gerekiyor.

## Asama 1

Web client'ta gorunen bridge contract'ini calistirmak:

- channels
- magazine articles
- article dynamic data
- favourites
- placeholder media
- server status

Bu asama su an baslatildi.

## Asama 2

Oyuncu state katmani:

- profile
- wallet
- localisation dictionary
- persistent object
- session object
- suspension / login state

## Asama 3

Garage ve arac sistemi:

- owned vehicles
- vehicle status
- showroom
- car shop
- tuning / performance
- active car

## Asama 4

Ekonomi ve magaza:

- purchases
- premium currency
- soft currency
- offers
- favourite channels / social rewards

## Asama 5

Event ve challenge backend:

- challenge articles
- leaderboard
- target/progress data
- career chapter structure
- recommended content

## Asama 6

Native bridge'e uyum:

- `GetServerData`
- `GetArticleData`
- `GetIndividualArticleData`
- `GetCachedArticles`
- `GetServerStatus`
- `ValidateAgainstServerTime`

## Asama 7

Gercek veri modeli:

- JSON'dan SQLite/Postgres'e gecis
- account table
- inventory table
- car table
- article cache table
- event progress table

## Su anki durum

Su anki kod tabani, `client_server_rebuild` altinda moduler hale getirildi.
Bu temel uzerine gercek oyun server'ini katman katman yazabiliriz.
