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
| `start.bat` / `run.bat` | Script | `.\start.bat` |
| sadece `index.html` | Statik Web | dahili HTTP sunucusu |

Bir klasör proje olarak tanınırsa içine daha fazla inilmez. `node_modules`, `dist`, `out`, `target`, `.git`, `venv` gibi klasörler atlanır.

## Ayarların saklandığı yer

`%APPDATA%\app-center\config.json` — kök klasörler, proje bazlı komut geçersiz kılmaları, gizlenen projeler ve `maxDepth` (varsayılan 3) burada tutulur.

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
