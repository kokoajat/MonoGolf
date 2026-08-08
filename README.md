# MonoGolf

18 väylän minigolfpeli selaimessa. Pallona on **superpallo**, joka kimpoaa laidoista
oikean jäykän kappaleen fysiikan mukaan. Lyönti tehdään **heilauttamalla puhelinta** –
heilautuksen suunta ja voimakkuus luetaan laitteen kiihtyvyysantureista. Kun pallo on
lähtenyt liikkeelle, anturien kuuntelu kytketään pois ja pallo vierii kentällä rauhassa
loppuun asti.

Ei riippuvuuksia, ei käännösvaihetta: pelkkää HTML:ää, CSS:ää ja ES-moduuleja.

## Käynnistys

Liikeanturit vaativat **suojatun yhteyden** (https tai `localhost`), joten peliä ei voi
avata suoraan `file://`-osoitteesta.

```bash
# projektin juuressa
python3 -m http.server 8080
# tai
npm start
```

Avaa selaimessa `http://localhost:8080`.

**Puhelimella pelatessa** sivu pitää tarjoilla https-osoitteesta. Ks. [Julkaisu](#julkaisu).

### Anturiluvat

- **iOS (Safari 13+)**: peli kysyy luvan liikeantureihin. Lupa voidaan pyytää vain
  käyttäjän napautuksesta, joten paina aloitusruudun *"Ota anturit käyttöön ja aloita"*.
- **Android (Chrome)**: anturit toimivat suoraan https-yhteydellä.
- Jos antureita ei ole tai lupa evätään, peli vaihtaa automaattisesti kosketusohjaukseen.

## Julkaisu

Repossa on valmis GitHub Pages -workflow (`.github/workflows/pages.yml`), joka julkaisee
sivuston jokaisella pushilla. **Pages pitää kytkeä päälle kerran käsin**, koska
workflowin oma token ei saa luoda Pages-sivustoa:

1. Repon **Settings → Pages**
2. **Build and deployment → Source: GitHub Actions**
3. **Actions → "Julkaise GitHub Pagesiin" → Run workflow** (tai pushaa mitä tahansa)

Tämän jälkeen peli löytyy osoitteesta `https://<käyttäjä>.github.io/MonoGolf/`.

### Yhden tiedoston versio

`npm run build` kokoaa koko pelin yhdeksi tiedostoksi `dist/index.html` (n. 80 kt, ei
ulkoisia viittauksia). Sen voi pudottaa mihin tahansa staattiseen hostiin tai lähettää
sellaisenaan – kaikki 18 väylää, fysiikka ja anturituki ovat mukana.

## Ohjaus

Ohjaustapaa vaihdetaan alapalkin painikkeesta.

| Tila | Suunta | Voima |
| --- | --- | --- |
| **Heilautus** (oletus puhelimella) | heilautuksen suunta | heilautuksen voimakkuus |
| **Kosketus + heilautus** | sormella asetettu tähtäys | heilautuksen voimakkuus |
| **Vain kosketus** (oletus tietokoneella) | vedä pallosta ritsan tapaan | vetomatka |

Heilautustilassa puhelinta pidetään **vaakatasossa näyttö ylöspäin** ja heilautetaan
siihen suuntaan, johon pallon halutaan lähtevän: puhelimen yläreunan suunta vastaa
ruudulla ylöspäin.

Alapalkin *Liike*-mittari näyttää anturin lukeman reaaliajassa, joten anturien toiminnan
näkee heti. *Voima*-mittari näyttää lyönnin tehon.

Muut painikkeet: **Alusta** aloittaa väylän alusta, **Tulokset** avaa tuloskortin (jonka
riviä napauttamalla voi siirtyä suoraan valitulle väylälle) ja kaiutinkuvake vaihtaa
äänet päälle/pois. Tulokset ja väylien ennätykset tallentuvat selaimen
`localStorage`-muistiin.

## Fysiikkamalli

Kaikki lasketaan SI-yksiköissä ja oikeilla mitoilla: pallon halkaisija 4,3 cm ja massa
45,9 g, väylä 1,62 m × 3,60 m, reikä 11 cm. Malli on `src/physics.js`:

- **Vierintävastus** hidastaa palloa pinnan mukaan (`a = μg`): viheriö μ = 0,115,
  karheikko 0,33, hiekka 0,62, jää 0,035.
- **Törmäys laitaan** ratkaistaan impulssina: normaalin suuntaan restituutiokerroin
  (laidat 0,82, kimmoisat tolpat 0,95), tangentin suuntaan Coulombin kitka
  `|j_t| ≤ μ|j_n|`. Kitkaimpulssi laskee jäykän pallon liukumisen pysäyttävästä
  impulssista `j = -v_t / (1/m + R²/I)`, missä `I = ⅖mR²`.
- **Kierre** syntyy törmäyksen kitkaimpulssin momentista, ja pystyakselin kierre kaartaa
  vierivää palloa sivusuunnassa. Kierre vaimenee pinnan kitkan mukaan.
- **Liikkuvat esteet** (myllyn siivet, liukuovet) huomioidaan suhteellisena nopeutena
  kosketuspisteessä, joten liikkuva palkki myös lyö palloa eteenpäin.
- **Kaltevat pinnat ja kiihdytyslaatat** lisäävät vakiokiihtyvyyden.
- **Reikä** nielaisee pallon vain, jos vauhti on alle 1,3 m/s – kovempaa pallo
  pyyhkäisee reunan yli.
- Askel jaetaan aliaskeliin niin, ettei pallo liiku kertaakaan yli 35 % säteestään.
  Näin ohuidenkaan seinien läpi ei tunneloiduta.

## Väylät

| # | Väylä | Par | Idea |
| --- | --- | --- | --- |
| 1 | Avaus | 2 | suora avausväylä |
| 2 | Portti | 2 | kaksi kapeaa aukkoa |
| 3 | Kulma | 3 | dogleg oikealle |
| 4 | Vastakulma | 3 | dogleg vasemmalle, kimmoisa tolppa |
| 5 | Kapeikko | 3 | porrastetut aukot |
| 6 | Kimmoke | 3 | vaatii laitakimmokkeen |
| 7 | Hiekkasärkät | 3 | hiekkaesteet |
| 8 | Vesieste | 3 | kapea silta veden yli |
| 9 | Mylly | 3 | pyörivät siivet |
| 10 | Ylämäki | 3 | rinne valuttaa takaisin |
| 11 | Flipperi | 3 | kimmoisat tolpat |
| 12 | Siksak | 4 | neljä mutkaa |
| 13 | Liukuovet | 4 | liikkuvat palkit |
| 14 | Kannas | 3 | kapea kannas veden keskellä |
| 15 | Jäärata | 3 | liukas jää, hiekkakulmat |
| 16 | Spiraali | 4 | kaksi kehää sisäänpäin |
| 17 | Risteys | 4 | turvallinen tai nopea reitti |
| 18 | Finaali | 5 | tolpat, liukuovi, vesi ja mylly |

Yhteispar 58.

## Kehitys

```
index.html          käyttöliittymän runko
styles.css          ulkoasu
src/physics.js      pallon liike, törmäykset ja kitka
src/world.js        radan geometria, pinnat ja liikkuvat esteet
src/courses.js      18 väylän määrittelyt (skaalataan metreiksi)
src/sensors.js      devicemotion-luku ja heilautuksen tunnistus
src/render.js       canvas-piirto
src/audio.js        WebAudio-tehosteet
src/game.js         tilakone, syötteet ja käyttöliittymä
tools/bundle.mjs    kokoaa kaiken yhdeksi HTML-tiedostoksi
```

### Testit

```bash
npm test              # molemmat alla olevat
npm run test:courses  # fysiikka + ratojen tarkistus (headless, ei selainta)
npm run test:browser  # Chromium: käyttöliittymä ja anturiohjaus
npm run build         # yhden tiedoston kooste dist/index.html
```

Koosteen voi testata samalla testillä:
`node tools/smoke.mjs --entry dist/index.html`.

`tools/simulate.mjs` ajaa fysiikkamoottoria ilman selainta ja tarkistaa jokaiselta
väylältä, että tiiaus ja reikä ovat kelvollisissa paikoissa, ettei pallo karkaa radalta
tai päädy NaN-tilaan satunnaisilla lyönneillä ja että reikä on saavutettavissa
(ruudukkoon laskettu etäisyyskenttä + lyöntejä kokeileva botti).

`tools/smoke.mjs` käynnistää pelin Chromiumissa, pelaa kosketuslyöntejä, syöttää
synteettisiä `devicemotion`-tapahtumia ja varmistaa, että heilautus laukaisee lyönnin
oikeaan suuntaan ja että anturit ovat pois päältä pallon vieriessä. Kuvakaappaukset
tallentuvat `.shots/`-kansioon.

## Lisenssi

MIT
