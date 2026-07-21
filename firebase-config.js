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
