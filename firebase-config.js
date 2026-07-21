// =============================================================
// firebase-config.js
// -------------------------------------------------------------
// ここに自分のFirebaseプロジェクトの設定値を入れてください。
//
// 【設定値の見つけ方】
// 1. https://console.firebase.google.com/ でプロジェクトを作成
// 2. 「Firestore Database」を作成する（本番モード or テストモードどちらでも可）
// 3. 「プロジェクトの設定」→「全般」→「マイアプリ」で
//    ウェブアプリ（</>アイコン）を追加すると、下のような値が発行されます。
// 4. その値をそのまま下の firebaseConfig にコピーしてください。
//
// 【セキュリティについて】
// このアプリは特定の個人（お子さん）だけが使う前提の簡易アプリです。
// 本格的に複数人へ配布する場合は、Firestoreのセキュリティルールで
// 読み書きできる人を制限することをおすすめします。
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ▼▼▼ ここを自分のFirebaseプロジェクトの値に書き換えてください ▼▼▼
const firebaseConfig = {
  apiKey: "AIzaSyAlqTKKpMubYJDXsvbEl4xZDcOt_SfODtQ",
  authDomain: "chs-books-e15f7.firebaseapp.com",
  projectId: "chs-books-e15f7",
  storageBucket: "chs-books-e15f7.firebasestorage.app",
  messagingSenderId: "821549004612",
  appId: "1:821549004612:web:bf1c583f8966990510c911"
};
// ▲▲▲ ここまで ▲▲▲

// Firebaseアプリを初期化して、他のファイル（app.js）から使えるようにします
const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);

// =============================================================
// 合言葉（あいことば）の正解ハッシュ
// -------------------------------------------------------------
// アプリ起動時の画面ロックに使う値です。合言葉そのものではなく、
// SHA-256でハッシュ化した文字列をここに入れます。
//
// 【作り方】
//   1. hash-tool.html をブラウザで開く（Netlifyなど https:// 経由で）
//   2. 好きな合言葉を入力して「計算する」をタップ
//   3. 出てきた64文字の文字列をそのまま下にコピーする
// =============================================================
export const CORRECT_PASSPHRASE_HASH = "bd984cda4f8f9f5cfdf1774598e28f10ef0f3249bd0e70a1a498ce5b88820267";
