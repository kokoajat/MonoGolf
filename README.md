# MonoGolf

**Pelaa: https://kokoajat.github.io/MonoGolf/**

18 väylän minigolfpeli selaimessa. Pallona on **superpallo**, joka kimpoaa laidoista
oikean jäykän kappaleen fysiikan mukaan. Lyönti tehdään **heilauttamalla puhelinta**:
liikkeen ajan kerätään talteen suunta ja voimakkuus, ja **pallo lähtee vasta kun
puhelin pysähtyy**. Sen jälkeen anturien kuuntelu kytketään pois ja pallo vierii
kentällä rauhassa loppuun asti.

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

### Koko näyttö ja asennus

Selainpalkit saa pois kahdella tavalla:

- **Koko näyttö** -painike valikossa käyttää selaimen Fullscreen APIa. Toimii
  Androidilla; valinta muistetaan ja palautetaan seuraavalla käynnistyksellä
  ensimmäisestä napautuksesta (API vaatii käyttäjän eleen).
- **Aloitusnäytölle lisääminen** on ainoa keino iOS-Safarissa, joka ei tue
  Fullscreen APIa muille kuin videoille. Peli on asennettava web-sovellus
  (`manifest.webmanifest`, `display: fullscreen`), joten aloitusnäytöltä
  käynnistettynä se avautuu ilman osoiteriviä kummallakin alustalla.

`sw.js` tallentaa pelin selaimen välimuistiin, joten se toimii myös ilman
verkkoyhteyttä. Sivu haetaan aina ensin verkosta, joten uusi julkaisu ei jää
välimuistiin jumiin.

Kuvakkeet generoidaan komennolla `node tools/icons.mjs` (Chromium rasteroi SVG:n).

### Anturiluvat

- **iOS (Safari 13+)**: peli kysyy luvan liikeantureihin. Lupa voidaan pyytää vain
  käyttäjän napautuksesta, joten paina aloitusruudun *"Ota anturit käyttöön ja aloita"*.
- **Android (Chrome)**: anturit toimivat suoraan https-yhteydellä.
- Jos antureita ei ole tai lupa evätään, peli vaihtaa automaattisesti kosketusohjaukseen.

## Julkaisu

Peli on julkaistu osoitteeseen **https://kokoajat.github.io/MonoGolf/**.

`.github/workflows/pages.yml` kokoaa pelin ja julkaisee sen uudelleen jokaisella
pushilla tämän haaran tai `main`in päälle. Sen voi ajaa myös käsin (**Actions →
"Julkaise GitHub Pagesiin" → Run workflow**).

Julkaistava sivusto on **yksi HTML-tiedosto** (`npm run build` → `dist/`). Erillisinä
tiedostoina selain tai CDN voi tarjoilla uuden `index.html`:n vanhan `styles.css`:n ja
`src/*.js`:n kanssa – silloin peliin ilmestyy painikkeita, joita vanha koodi ei tunne.
Koosteena päivitys on atominen. Service workerin versio sidotaan koosteen tiivisteeseen,
joten uusi julkaisu ei jää välimuistin taakse.

Forkkia varten: Pages pitää kytkeä kerran päälle repon asetuksista
(**Settings → Pages → Build and deployment → Source: GitHub Actions**), koska
workflowin oma token ei saa luoda Pages-sivustoa.

### Yhden tiedoston versio

`npm run build:standalone` kokoaa pelin yhdeksi täysin itsenäiseksi tiedostoksi
`dist/monogolf.html` (n. 108 kt). Sen voi lähettää sellaisenaan tai avata mistä tahansa –
kaikki 18 väylää, fysiikka ja anturituki ovat mukana. Tässä versiossa ei ole manifestia
eikä service workeria, joten sitä ei voi asentaa aloitusnäytölle; siihen käytetään
varsinaista sivustoa.

## Ohjaus

Ohjaustapaa vaihdetaan alapalkin painikkeesta.

| Tila | Suunta | Voima |
| --- | --- | --- |
| **Heilautus** (oletus puhelimella) | heilautuksen suunta | heilautuksen voimakkuus |
| **Tähtäys** | sormella asetettu tähtäys | heilautuksen voimakkuus |
| **Kosketus** (oletus tietokoneella) | vedä pallosta ritsan tapaan | vetomatka |

Heilautustilassa puhelinta pidetään **vaakatasossa näyttö ylöspäin** ja heilautetaan
siihen suuntaan, johon pallon halutaan lähtevän: puhelimen yläreunan suunta vastaa
ruudulla ylöspäin.

Lyönnin kulku on kaksivaiheinen: niin kauan kuin puhelin liikkuu, peli integroi
kiihtyvyydestä puhelimen nopeuden ja kerää siitä huippunopeuden (= voima) sekä
nopeudella painotetun suunnan. Kun puhelin on ollut paikallaan hetken, lyönti laukeaa.
Suunta luetaan nimenomaan nopeudesta eikä kiihtyvyyden huipusta: heilautuksen voimakkain
kiihtyvyyspiikki on usein lopun jarrutus, joka osoittaa vastakkaiseen suuntaan.

Rata täyttää koko ruudun. Radan päällä kelluvat vain tilateksti ja mittarit: *Liike*
näyttää anturin lukeman reaaliajassa ja *Voima* lyönnin tehon. Kaikki painikkeet ovat
yläkulman **rataskuvakkeen** takana, eivätkä ne vie tilaa pelialueelta.

Pallon vieriessä mittaritkin väistyvät ja kamera seuraa palloa: hitaassa vauhdissa
lähempää, kovassa vauhdissa laajemmalta, jotta pallon eteen ehtii nähdä. Kun pallo
pysähtyy, näkymä palaa koko väylään.

Valikon painikkeet: **Alusta väylä** aloittaa väylän alusta, **Tulokset** avaa
tuloskortin (jonka riviä napauttamalla voi siirtyä suoraan valitulle väylälle),
**Nollaa peli** aloittaa kierroksen alusta väylältä 1 (ennätykset voi säilyttää tai
nollata) ja kaiutinkuvake vaihtaa äänet päälle/pois.

Tulokset ja ennätykset tallentuvat selaimen `localStorage`-muistiin. Kesken jäänyt
kierros jatkuu seuraavalla käynnistyksellä siltä väylältä, jolle se jäi – aloitusruutu
kertoo tämän ja tarjoaa myös aloituksen alusta. Loppuun pelattu kierros nollautuu
itsestään.

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
- **Kaltevat pinnat ja kiihdytyslaatat** lisäävät vakiokiihtyvyyden. Paikallaan olevaa
  palloa pitää paikallaan vain lepokitka, joka on vierintävastusta pienempi – siksi
  pallo lähtee itsestään vierimään alamäkeen. Rinteet mitoitetaan niin, että niiden
  kiihtyvyys ylittää vierintävastuksen selvästi; muuten pallo jäisi ryömimään tai
  nykimään liike- ja lepotilan rajalla. `tools/simulate.mjs` tarkistaa tämän.
- **Reikä** nielaisee pallon vain, jos vauhti on alle 1,3 m/s – kovempaa pallo
  pyyhkäisee reunan yli.
- Askel jaetaan aliaskeliin niin, ettei pallo liiku kertaakaan yli 35 % säteestään.
  Näin ohuidenkaan seinien läpi ei tunneloiduta.

## Väylät

| # | Väylä | Par | Idea |
| --- | --- | --- | --- |
| 1 | Avaus | 2 | suora avausväylä |
| 2 | Portti | 2 | kaksi kapeaa aukkoa pylväiden välissä |
| 3 | Kulma | 3 | dogleg oikealle |
| 4 | Vastakulma | 3 | dogleg vasemmalle, kimmoisa tolppa |
| 5 | Kapeikko | 3 | porrastetut aukot |
| 6 | Kimmoke | 3 | kaarevat seinät, vaatii kimmokkeen |
| 7 | Hiekkasärkät | 3 | pyöreät hiekkalaikut |
| 8 | Vesieste | 3 | kapea silta veden yli |
| 9 | Mylly | 3 | pyörivät siivet |
| 10 | Ylämäki | 3 | rinne valuttaa takaisin |
| 11 | Flipperi | 3 | kapseliareena ja kimmoisat tolpat |
| 12 | Siksak | 4 | neljä vinoa mutkaa |
| 13 | Liukuovet | 4 | liikkuvat palkit |
| 14 | Saari | 3 | rengasmainen lampi, saari ja kannas |
| 15 | Jäärata | 3 | liukas jää, hiekkakulmat |
| 16 | Spiraali | 4 | kaksi kaarevaa kehää sisäänpäin |
| 17 | Risteys | 4 | turvallinen tai nopea reitti |
| 18 | Finaali | 5 | tolpat, liukuovi, vesi ja mylly |

Yhteispar 58.

Väylien geometria kirjoitetaan `src/courses.js`:ssä ruudukkoyksiköissä. Käytettävissä on
sekä suoria muotoja (`rect`, `box`) että pyöreitä (`circlePoly`, `roundedRect`,
`stadium`, `arcWall`, `post`); vyöhykkeet voivat olla suorakaiteita, ympyröitä tai
monikulmioita. Pintavyöhykkeistä myöhempi voittaa aiemman, joten veden päälle voi
piirtää saaren tai kannaksen.

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
manifest.webmanifest  asennettavan sovelluksen määrittely
sw.js                 välimuisti ja offline-tuki
icons/                sovelluskuvakkeet
tools/bundle.mjs      kokoaa kaiken yhdeksi HTML-tiedostoksi
tools/icons.mjs       generoi kuvakkeet
```

### Testit

```bash
npm test              # molemmat alla olevat
npm run test:courses  # fysiikka + ratojen tarkistus (headless, ei selainta)
npm run test:browser  # Chromium: käyttöliittymä ja anturiohjaus
npm run build         # julkaistava sivusto dist/
npm run test:dist     # sama selaintesti julkaistavaa koostetta vasten
```

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
