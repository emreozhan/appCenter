# App Center

AI ile ürettiğin projeleri tek bir masaüstü panelden bulan, kuran, build eden ve çalıştırıp durduran bir Electron uygulaması.

Verdiğin kök klasörlerin altındaki alt klasörleri tarar, her projenin tipini otomatik tanır (Electron, Vite, Tauri, Node sunucu, Python, .NET/C#, Java, Go, Rust, statik HTML, .bat) ve her biri için kurulum / build / çalıştırma komutlarını üretir. Komutları beğenmezsen proje bazında kendi komutunu yazabilirsin.

## Kurulum

```bash
npm install
```

## Çalıştırma

```bash
npm start
```

İlk açılışta uygulamanın bulunduğu klasörün üstü (`...\AiProjects`) kök klasör olarak eklenir. **Klasörler** butonundan istediğin kadar kök klasör ekleyip kaldırabilirsin; hepsi birlikte, 3 seviye derinliğe kadar taranır (`homeTool\yeelight-controller` gibi iç içe projeler de bulunur).

## Neler yapabilir

| Özellik | Açıklama |
|---|---|
| **▶ Başlat / ■ Durdur** | Projeyi kendi klasöründe çalıştırır. Durdurma, alt süreçleri de kapatır (`taskkill /T`), yani `npm run dev` altındaki vite/electron süreçleri de temizlenir. |
| **🔨 Build** | Algılanan build komutunu çalıştırır, çıktıyı log panelinde gösterir. |
| **⤓ Kur** | `npm install` / `pip install -r requirements.txt` gibi kurulum komutunu çalıştırır. `node_modules` yoksa kartta "kurulum gerekli" rozeti çıkar. |
| **🌐 Aç** | Çalışan projenin log çıktısından yakalanan `http://localhost:PORT` adresini sistem tarayıcısında açar. |
| **📄 Log** | Canlı stdout/stderr akışı, alt panelde. |
| **📁 / >_** | Proje klasörünü Explorer'da, veya klasörü terminalde açar. |
| **⚙ Ayarlar** | Görünen adı, kurulum/build/çalıştırma komutlarını ve ortam değişkenlerini proje bazında değiştirir. Boş bıraktığın alan otomatik algılamaya döner. |
| **Arama / filtre** | İsim, yol, tip veya açıklamaya göre arama; duruma ve tipe göre filtre. |
| **Tümünü Durdur** | Çalışan bütün projeleri kapatır. Uygulamadan çıkarken de otomatik yapılır. |
| **Gizliler** | İlgilenmediğin projeleri listeden gizler, checkbox ile geri getirir. |
| **▾ / ▸ Daralt** | Her kart başlığındaki ok (veya kart adına tıklama) kartı tek satıra indirir; daraltılmış kartta küçük ▶/■ butonu kalır. Üst çubuktaki **Tümünü Daralt / Genişlet** görünen tüm kartlara uygulanır. Durum kalıcıdır. |
| **☆ Favori** | Yıldızlanan kartlar listenin başına gelir. Grup içindeki bir uygulama favoriyse hem grup kartı başa çıkar hem de o uygulama grubun içinde ilk sıraya geçer. |
| **Grup kartları** | Kök klasörün doğrudan altında olmayan (iç içe) projeler, üst klasörlerinin tek kartında toplanır — ör. `homeTool` kartı içinde `yeelight-controller` ve `CodeOnlyWindowsApplication`. Her alt uygulamanın kendi Başlat/Build/Log butonları vardır. |
| **Başlangıçta aç** | İşaretlendiğinde App Center, Windows oturumu açıldığında otomatik başlar (`HKCU\...\CurrentVersion\Run`). Kaydı Electron'un `setLoginItemSettings` API'si yönetir; kapatınca kayıt silinir. Paketlenmemiş çalışırken kayıt `electron.exe "<proje klasörü>"` şeklindedir, yani `node_modules` durduğu sürece geçerlidir. |

Statik HTML projeleri (ör. `m3u-player`) için ayrı bir sunucuya gerek yok — uygulama boş bir porta dahili bir HTTP sunucusu açar ve adresi verir.

Kısayollar: `Ctrl+F` arama, `F5` / `Ctrl+R` yeniden tara, `Esc` açık pencereyi kapat.

## Proje tipi algılama

| Bulunan dosya | Tip | Çalıştırma |
|---|---|---|
| `package.json` + `src-tauri/` | Tauri | `npm run tauri dev` |
| `package.json` + `electron` bağımlılığı | Electron | `npm run dev` ya da `npm start` |
| `package.json` + `next` | Next.js | `npm run dev` |
| `package.json` + `vite` | Vite | `npm run dev` |
| `package.json` (diğer) | Node | `npm start` ya da `node <main>` |
| `*.csproj` / `build.cmd` + `*.cs` | .NET / C# | `.\<uygulama>.exe` ya da `dotnet run` |
| `pom.xml` / `build.gradle` | Java | `mvn spring-boot:run` / `gradlew bootRun` |
| `Cargo.toml` | Rust | `cargo run` |
| `go.mod` | Go | `go run .` |
| `manage.py` / `app.py` / `main.py` / `serve.py` | Python | `python <dosya>` (varsa `.venv` yorumlayıcısı) |
| yalnız `start.cmd` / `build.cmd` | Script | `.\start.cmd` |
| sadece `index.html` | Statik Web | `start.cmd` yoksa dahili HTTP sunucusu |

Tablodaki komutlar yalnızca projenin yapılandırmasında karşılığı varsa kullanılır (ör. `package.json`'da `dev`/`start` script'i). Yoksa kökteki `start.cmd` / `build.cmd` devreye girer (bkz. [Kok build ve start scriptleri](#kok-build-ve-start-scriptleri)).

Bir klasör proje olarak tanınırsa içine daha fazla inilmez. `node_modules`, `dist`, `out`, `target`, `.git`, `venv` gibi klasörler atlanır.

## Ayarların saklandığı yer

`%APPDATA%\app-center\config.json` — kök klasörler, proje bazlı komut geçersiz kılmaları, gizlenen projeler, favoriler, daraltılmış kartlar ve `maxDepth` (varsayılan 3) burada tutulur.

## Mimari

```
src/
├── main/                 # Node erişimi olan main process
│   ├── index.js          # pencere, uygulama yaşam döngüsü
│   ├── config.js         # config.json okuma/yazma
│   ├── detector.js       # klasör -> proje tipi + komutlar
│   ├── scanner.js        # kök klasörleri gezme
│   ├── processManager.js # spawn / kill / log / durum
│   ├── staticServer.js   # statik projeler için dahili HTTP
│   └── ipc/handlers.js   # tüm ipcMain.handle kanalları
├── preload/index.js      # contextBridge ile sınırlı API
├── renderer/             # UI (Node erişimi yok)
└── shared/ipc-channels.js
```

Güvenlik: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Renderer'a ham `ipcRenderer` verilmez; sadece isimlendirilmiş fonksiyonlar açılır ve gelen her proje kimliği main tarafında son tarama sonucuna karşı doğrulanır.

## Paketleme

```bash
npm run dist
```

`electron-builder` ile Windows kurulumu üretir.

## Kok build ve start scriptleri

Proje kokunde `build.cmd` ve `start.cmd` bulunmasi yeterlidir (komutlar: `.\build.cmd`, `.\start.cmd`).
Algilama onceligi build icin `build.cmd > build.bat > build.ps1`, start icin
`start.cmd > start.bat > start.ps1 > run.cmd > run.bat > run.ps1` seklindedir.
Komut onceligi (yukaridan asagi):

1. Ayarlarda (⚙) elle girilen komut
2. Projenin yapilandirmasi: `package.json` script'i (`dev`/`start`, `build`/`dist`), `*.csproj`, `pom.xml`, `Cargo.toml`, `go.mod`, Python giris dosyasi, `.exe`
3. Kokteki `start.cmd` / `build.cmd` (yapilandirmada komut yoksa)
4. Salt tahmin: `npx vite`, `npx electron .`, `npx next dev`, statik projede dahili sunucu

Yani `package.json`'unda `dev` script'i olan bir Vite projesi `npm run dev` ile, script'i olmayan bir proje `.\start.cmd` ile baslar; proje tipi her durumda korunur.
PowerShell scriptleri NoProfile ile calisir.
Degisiklikten sonra uygulamayi yeniden baslatin ve Yenile ile tarayin; eski ozel komut varsa ayarlardan sifirlayin.

Yalniz script iceren semsiye klasorler alt projeleri gizlemez; maxDepth sinirina kadar taranmaya devam eder.
Boyle bir klasorun alt projeleri varsa klasor ayri kart olarak gorunmez; kendi grup kartinin ilk satiri
("klasor koku") olur, alt projeler onun altinda listelenir.
Bos/iskeletten ibaret projeler hata kodu ve aciklayici mesaj verir. Belge projelerinde build derleme gerekmedigini,
start ilgili belgeyi gosterir. CAD/oyun modlari gibi harici ana uygulama isteyen projeler gereksinimlerini bildirir.
Scriptler calisma dizinini kendi klasorune alir, hata kodlarini aktarir ve kullanici girdisi beklemez.
Mevcut eski scriptler korunur. Node projelerinde kurulum icin README'deki npm komutunu kullanin.

Algilama ve tarama regresyon kontrolleri: `npm test`.
