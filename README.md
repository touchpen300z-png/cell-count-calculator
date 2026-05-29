# Concentration Calculator

軽量な濃度計算アプリです。HTML/CSS/JavaScriptのみで動作します。

## 使い方

`index.html` をブラウザで開くか、GitHub Pagesに公開して使います。

## スマホで使う

GitHub Pagesに公開したURLをスマホで開くと使えます。

### iPhone / iPad

SafariでURLを開き、共有ボタンから「ホーム画面に追加」を選びます。

### Android / Chrome

ChromeでURLを開き、表示される「Install」ボタン、またはブラウザメニューの「アプリをインストール」/「ホーム画面に追加」を使います。

## v4の追加点

- スマホ向けレイアウトを追加
- PWA manifestを追加
- Service Workerで基本ファイルをキャッシュ
- ホーム画面追加用アイコンを追加

## 注意

履歴と保存条件はブラウザのlocalStorageに保存されます。端末・ブラウザごとに別管理です。重要な条件はJSONでExportしてください。

スマホブラウザでは、クリップボード制限により「Copy as image」が使えない場合があります。その場合はPNG保存を使ってください。
