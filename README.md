# Anatomi 3D Atlas (Z-Anatomy + GitHub Pages + Çevrimdışı Android APK)

Bu proje, açık kaynaklı [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy) (CC BY-SA 4.0) ve [BodyParts3D](https://lifesciencedb.jp/bp3d/?lng=en) (CC BY-SA 2.1 JP) veri setlerini **GitHub Actions** bulut sunucusunda yüksek detaylı sistem katmanlarına (`.glb`) dönüştürerek hem **GitHub Pages** üzerinden webde yayınlar hem de **Capacitor** ile tam çevrimdışı çalışan **Android `.apk`** derler.

## Termux Üzerinden Kurulum ve Derleme (Android SDK / Blender Gerekmez)

1. Termux'ta gerekli araçları kurun:
   ```bash
   pkg update && pkg install -y git nodejs-lts unzip
   ```
2. Bu klasörü açın ve GitHub'da oluşturduğunuz boş depoya gönderin:
   ```bash
   unzip anatomi-3d-atlas.zip -d anatomi-3d
   cd anatomi-3d
   git init
   git branch -M main
   git add .
   git commit -m "Z-Anatomy 3D Atlas kurulumu"
   git remote add origin https://github.com/KULLANICI_ADIN/REPO_ADIN.git
   git push -u origin main
   ```
3. GitHub deponuzda şu iki ayarı 1 kez açın:
   - **Settings → Pages → Build and deployment → Source:** `GitHub Actions` seçin.
   - **Settings → Actions → General → Workflow permissions:** `Read and write permissions` seçip kaydedin.
4. **Actions** sekmesinde `Build Web (GitHub Pages) & Offline Android APK` iş akışı tamamlandığında:
   - Web sürümü **GitHub Pages** adresinizde yayına girer.
   - Tam çevrimdışı **Anatomi3D-Atlas.apk** dosyası **Releases** (ve Actions Artifacts) sekmesinden doğrudan telefonunuza indirilebilir.
