# 物冊｜財產清冊 Android App

Android 9 以上的離線財產清冊。清冊、照片、抬頭與格子設定保存在 App 內；不需登入、不會將清冊上傳到 GitHub。

[下載 APK 安裝檔](https://github.com/dielin44/property-inventory-android/releases/download/v1.0.0/property-inventory-1.0.0.apk) · [版本與下載說明](https://github.com/dielin44/property-inventory-android/releases/tag/v1.0.0)

## 功能

- 序號、名稱、照片、數量、備註；批量新增物品及自訂欄位。
- 拖曳調整欄寬、列高，交換欄位與整列。
- 開啟手機相機拍照，或從相簿選圖；縮放、移動、旋轉及重新裁切。
- 多個抬頭文字框可自由移動、縮放、設定文字樣式。
- A4 直式／橫式預覽與真正的 `.docx` 匯出。表格文字可編輯，抬頭保留為圖片。
- JSON 備份與匯入，包含清冊、照片與版面。匯入時保留現有清冊。
- Word 與備份使用 Android 系統「另存新檔」，可選擇儲存位置。

## 安裝與資料移轉

下載簽署後的 APK，在 Android 開啟安裝。首次側載時，依手機提示允許下載來源安裝。

網頁版與 App 的本機資料分開：請先在網頁版「匯出備份」，再於 App 左上清冊選單「匯入備份」。解除安裝、清除 App 資料或更換手機前，請先匯出 JSON 備份。

## 建置

需要 JDK 17、Android SDK platform 35／build-tools 35.0.0。

```sh
node scripts/check.mjs
./gradlew assembleDebug
```

測試 APK 輸出：`app/build/outputs/apk/debug/app-debug.apk`。

正式版本使用私下保存的簽署金鑰。先設定環境變數 `INVENTORY_KEYSTORE`（絕對路徑）、`INVENTORY_STORE_PASSWORD`、`INVENTORY_KEY_ALIAS`（預設 inventory）與 `INVENTORY_KEY_PASSWORD`（未設則沿用 store password）：

```sh
./gradlew assembleRelease
```

已簽署 APK 輸出：`app/build/outputs/apk/release/app-release.apk`。後續更新維持相同 applicationId 與簽署金鑰，並增加 versionCode。

## GitHub 自動建置

將本專案上傳到公開儲存庫的 main 分支後，Actions 的 **Build Android APK** 會檢查匯出流程並建置可安裝的測試 APK；也可使用 Run workflow。從工作流程的 Artifacts 下載 `property-inventory-1.0.0-apk` 並解壓縮。GitHub 下載 Artifacts 可能需要登入。

Actions 目前使用測試簽章。直接提供的正式 APK 使用獨立簽章；兩者不可互相覆蓋更新。正式版本的金鑰與密碼不在本專案中，也不得提交到公開儲存庫。

## 結構與限制

- `app/src/main/assets/www/`：離線網頁、裁切、Word 產生器、原生檔案匯出橋接。
- `app/src/main/java/com/dielin44/inventory/MainActivity.java`：WebView、相機、系統檔案選取與儲存。
- 不申請網路、整個相簿或廣泛儲存權限；僅處理使用者選取的檔案。
- 拍照呼叫手機既有相機 App；需有可用的相機及檔案管理程式。
- WebView 需支援 ES modules、IndexedDB、Canvas、Blob；建議保持 Android System WebView 更新。
- 單張照片上限 40MB，備份與原生匯出上限 200MB；大型清冊建議分開保存。
- 已通過的程式與建置驗證不等同實機驗證；實際相機返回、儲存位置、背景切換及重新開啟後資料保留仍需於目標手機確認。

## 公開原始碼

本專案包不包含使用者清冊、照片、簽署金鑰、帳號憑證或網站部署身分。第三方 AndroidX 等依賴遵循各自授權；APK 內保留依賴提供的授權資料。
