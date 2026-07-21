// =============================================================
// app.js
// -------------------------------------------------------------
// このファイルがアプリの「動き」をぜんぶ担当しています。
// 大きく分けて次のブロックがあります。上から順に読めば流れがわかります。
//
//   1. Firestoreの読み込み・関数の準備
//   2. アプリ全体で使う「状態（state）」
//   3. 小さな便利関数（ユーティリティ）
//   4. 設定（お気に入りマーク・さいどく色）まわりの処理
//   5. 本のデータをFirestoreから読み込む・書き込む処理
//   6. 画面を描画する処理（一覧・背表紙）
//   7. 検索・並び替え・絞り込み
//   8. 詳細モーダル（閲覧⇔編集）
//   9. 「よんだ！」の処理と演出
//  10. コピー・削除
//  11. トースト表示
//  12. 画面の部品（DOM）とイベントの登録
//
// 拡張したくなったとき（例：新しい項目を本に追加したい）は、
// 「2. 状態」のbookの形と、「6. 描画」「8. 詳細モーダル」を
// あわせて直すのが基本の流れです。
// =============================================================

import { db, CORRECT_PASSPHRASE_HASH } from "./firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------------------------------------
// 0. 合言葉（あいことば）による簡易保護
// ---------------------------------------------------------
// 仕組み（予定表アプリ＝デイリープランと同じ考え方に合わせています）：
//   ・画面ロックの正解判定には、合言葉をSHA-256でハッシュ化した値を使う
//     （このJSファイルを人が見ても、合言葉そのものは書かれていない）
//   ・入力が正解だったら、そのときの「入力した合言葉そのもの（平文）」を
//     Firestoreの保存先パスの一部として使う
//   ・Firestoreのセキュリティルール側は、そのパスの合言葉が
//     許可リストに入っているかどうかで読み書きを許可する、という作りなので、
//     アプリ側もハッシュではなく「平文の合言葉」をパスに使う必要がある
//   ・一度成功したら合言葉（平文）をlocalStorageに保存し、次回から自動で入れるようにする
//
// 正解ハッシュ（CORRECT_PASSPHRASE_HASH）は firebase-config.js の方に
// まとめてあります。作り方や書き換え方もそちらのコメントを見てください。
//
// 【Firestoreのセキュリティルールについて】
//   予定表アプリと同じ合言葉を使う場合は、ルール側の isAllowedSpace() に
//   その合言葉（平文）を追加し、次のような一致するmatchブロックも足してください。
//
//      match /groups/{spaceId}/{document=**} {
//        allow read, write: if isAllowedSpace(spaceId);
//      }
//
const AUTH_STORAGE_KEY = "yomilog-auth-passphrase";

// ---------------------------------------------------------
// 1. Firestoreのコレクション・ドキュメントの場所
// ---------------------------------------------------------
// 合言葉（平文）ごとに保存場所を分けます。
// 例：groups/【合言葉】/books ／ groups/【合言葉】/settings/main
// これにより「同じ合言葉を知っている端末どうし」だけがデータを共有します。
let booksCollectionRef = null;
let settingsDocRef = null;

function setupFirestoreRefs(passphrase) {
  booksCollectionRef = collection(db, "groups", passphrase, "books");
  settingsDocRef = doc(db, "groups", passphrase, "settings", "main");
}

// ---------------------------------------------------------
// 2. アプリ全体で使う状態（state）
// ---------------------------------------------------------
// 設定のデフォルト値。Firestoreにまだ設定が無いときはこれを使います。
// favoriteMarks: 「お気に入りマークの候補」。自由に追加・削除できます。
// activeFavoriteMarkId: 候補の中から、実際に5段階表示で使う1つを指定します。
// rereadColors: しおりの色。7個ぶん。使わない場所はnull（＝白色）。
const DEFAULT_SETTINGS = {
  favoriteMarks: [
    { id: "mark-star", emoji: "⭐" },
    { id: "mark-snow", emoji: "❄️" },
    { id: "mark-gift", emoji: "🎁" },
    { id: "mark-book", emoji: "📚" },
    { id: "mark-bolt", emoji: "⚡️" },
  ],
  activeFavoriteMarkId: "mark-star",
  rereadColors: [null, null, null, null, null, null, null],
};

// 背表紙に使う色のパレット（本ごとに落ち着いた色を自動で割り当てます）
const SPINE_COLOR_PALETTE = [
  "#F2A65A", "#5AA9C4", "#E27D7D", "#8FBF7F",
  "#C79ADB", "#F2C14E", "#6FA8DC", "#E8935F",
];

const state = {
  books: [],              // Firestoreから読み込んだ本の一覧（生データ）
  settings: DEFAULT_SETTINGS,
  searchQuery: "",         // 「さがす」ボタンが押されたときにセットされる
  sortKey: "title-asc",
  filterKey: "all",        // all / reread-on / reread-off
  currentBookId: null,     // 詳細モーダルで開いている本のID
  pendingReadDate: null,   // 「よんだ！」で記録する予定の日付（YYYY-MM-DD）
};

// ---------------------------------------------------------
// 3. 小さな便利関数
// ---------------------------------------------------------

// 文字列をSHA-256でハッシュ化し、16進数の文字列にして返す
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// かんたんなユニークID（設定内のマークや色のID用。FirestoreのドキュメントIDとは別物）
function makeLocalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// 今日の日付を "YYYY-MM-DD" 形式で返す（端末のローカル時間を基準にする）
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "YYYY-MM-DD" を "YYYY年M月D日" のような読みやすい表示に変換
function formatDateJp(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

// 縦書きの1列に入れる文字数の目安（これを超えると次の列へ折り返す）
const SPINE_WRAP_CHAR_COUNT = 15;
const SPINE_LINE_HEIGHT = 1.35;

// タイトル・サブタイトルの合計文字数に応じて文字サイズを自動調整（数値のpxで返す）
// 折り返し自体は別で行うので、ここはあくまで「太くなりすぎない」ための調整
function fontSizeForTitle(title, subtitle) {
  const len = title.length + (subtitle ? subtitle.length : 0);
  if (len <= 8) return 20;
  if (len <= 14) return 17;
  if (len <= 22) return 15;
  if (len <= 34) return 13;
  return 12;
}

// 文字列からパレット内の色を安定的に選ぶ（同じ本は毎回同じ色になる）
function colorForBookId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 100000;
  }
  return SPINE_COLOR_PALETTE[hash % SPINE_COLOR_PALETTE.length];
}

// 本の「最新に読んだ記録（エントリそのもの）」を履歴から取得（履歴が無ければnull）
// 同じ日付が複数あるときは、配列の中で一番あとに追加されたもの（＝一番最近の操作）を返す
function getLastReadEntry(book) {
  if (!book.readHistory || book.readHistory.length === 0) return null;
  let latest = null;
  for (const entry of book.readHistory) {
    if (!latest || entry.date >= latest.date) {
      latest = entry;
    }
  }
  return latest;
}

// 本の「最新に読んだ日」を履歴から取得（履歴が無ければnull）
function getLastReadDate(book) {
  const entry = getLastReadEntry(book);
  return entry ? entry.date : null;
}

// 今、5段階のおきにいり表示に使われているマークを返す
// （設定が壊れていて見つからない場合は、候補の一番上を代わりに使う）
function getActiveFavoriteMark() {
  return state.settings.favoriteMarks.find(m => m.id === state.settings.activeFavoriteMarkId)
    || state.settings.favoriteMarks[0];
}

// ---------------------------------------------------------
// 4. 設定（お気に入りマーク・さいどく色）
// ---------------------------------------------------------

async function loadSettingsOnce() {
  const snap = await getDoc(settingsDocRef);
  if (snap.exists()) {
    state.settings = normalizeSettings(snap.data());
  } else {
    // 初回起動時：デフォルト設定をFirestoreに書き込む
    await setDoc(settingsDocRef, DEFAULT_SETTINGS);
    state.settings = DEFAULT_SETTINGS;
  }
}

// 保存されている設定の形が壊れていても、できるだけ安全に補正して使う
function normalizeSettings(data) {
  const favoriteMarks = Array.isArray(data.favoriteMarks) && data.favoriteMarks.length > 0
    ? data.favoriteMarks
    : DEFAULT_SETTINGS.favoriteMarks;

  let rereadColors = Array.isArray(data.rereadColors) ? data.rereadColors.slice(0, 7) : [];
  while (rereadColors.length < 7) rereadColors.push(null);

  // 使用中マークが候補の中に無い（削除された等）場合は、候補の一番上へ自動で戻す
  const activeExists = favoriteMarks.some(m => m.id === data.activeFavoriteMarkId);
  const activeFavoriteMarkId = activeExists ? data.activeFavoriteMarkId : favoriteMarks[0].id;

  return { favoriteMarks, activeFavoriteMarkId, rereadColors };
}

async function saveSettings() {
  try {
    await setDoc(settingsDocRef, state.settings);
  } catch (err) {
    console.error("せっていの保存に失敗しました:", err);
    showToast("せっていの保存に\nしっぱいしたみたい…");
  }
}

// お気に入りマークを追加
async function addFavoriteMark(emoji) {
  if (!emoji) return;
  state.settings.favoriteMarks.push({ id: makeLocalId("mark"), emoji });
  await saveSettings();
  renderSettingsModal();
}

// お気に入りマークを削除。
// 今つかっているマークが削除された場合は「一番上の候補」へ自動でつけかえる。
// （本のデータには番号[段階]しか保存していないので、本のデータ側を直す必要はない）
async function removeFavoriteMark(markId) {
  if (state.settings.favoriteMarks.length <= 1) {
    showToast("マークは\n1こ以上のこしてね");
    return;
  }
  state.settings.favoriteMarks = state.settings.favoriteMarks.filter(m => m.id !== markId);

  if (state.settings.activeFavoriteMarkId === markId) {
    state.settings.activeFavoriteMarkId = state.settings.favoriteMarks[0].id;
  }

  await saveSettings();
  renderSettingsModal();
  renderBookGrid();
}

// 5段階表示に使うマークを切り替える
async function setActiveFavoriteMark(markId) {
  state.settings.activeFavoriteMarkId = markId;
  await saveSettings();
  renderSettingsModal();
  renderBookGrid();
}

// さいどく色（1〜7）を変更
async function setRereadColor(slotIndex, colorValue) {
  state.settings.rereadColors[slotIndex] = colorValue || null;
  await saveSettings();
  renderBookGrid(); // しおりの色に反映
}

// ---------------------------------------------------------
// 5. Firestoreからの読み込み（リアルタイム同期）
// ---------------------------------------------------------

function subscribeToBooks() {
  onSnapshot(
    booksCollectionRef,
    (snapshot) => {
      state.books = snapshot.docs.map(d => normalizeBook(d.id, d.data()));
      renderBookGrid();
      // 詳細モーダルを開いている最中にデータが変わったら表示も更新する
      if (state.currentBookId && !document.getElementById("modal-detail").hidden) {
        const book = state.books.find(b => b.id === state.currentBookId);
        if (book) renderDetailView(book);
      }
    },
    (error) => {
      // Firestoreの設定やセキュリティルールが原因で読み込めない場合はここに来る
      console.error("本のデータ取得エラー:", error);
      showToast("本のデータが\nよみこめないみたい…");
    }
  );
}

// 保存されている本のデータが多少壊れていても表示できるように補正する
function normalizeBook(id, data) {
  return {
    id,
    title: data.title || "（タイトルなし）",
    subtitle: data.subtitle || "",
    volume: Number.isFinite(data.volume) ? data.volume : 1,
    author: data.author || "",
    protected: data.protected !== false, // 未設定ならデフォルトON
    reread: !!data.reread,
    rereadColorSlot: Number.isFinite(data.rereadColorSlot) ? data.rereadColorSlot : 1,
    favoriteLevel: Math.min(5, Math.max(0, Number.isFinite(data.favoriteLevel) ? data.favoriteLevel : 0)),
    readCount: Number.isFinite(data.readCount) ? data.readCount : 0,
    readHistory: Array.isArray(data.readHistory) ? data.readHistory : [],
    createdAt: data.createdAt || 0,
  };
}

// ---------------------------------------------------------
// 6. 画面の描画（一覧・背表紙）
// ---------------------------------------------------------

function getVisibleBooks() {
  let list = [...state.books];

  // 絞り込み
  if (state.filterKey === "reread-on") list = list.filter(b => b.reread);
  if (state.filterKey === "reread-off") list = list.filter(b => !b.reread);

  // 検索（タイトルのみ。サブタイトルは対象外）
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(b => b.title.toLowerCase().includes(q));
  }

  // 並び替え
  switch (state.sortKey) {
    case "title-asc":
      list.sort((a, b) => a.title.localeCompare(b.title, "ja"));
      break;
    case "title-desc":
      list.sort((a, b) => b.title.localeCompare(a.title, "ja"));
      break;
    case "volume-asc":
      list.sort((a, b) => a.volume - b.volume);
      break;
    case "favorite-desc":
      list.sort((a, b) => b.favoriteLevel - a.favoriteLevel);
      break;
    case "favorite-asc":
      list.sort((a, b) => a.favoriteLevel - b.favoriteLevel);
      break;
  }
  return list;
}

function renderBookGrid() {
  const grid = document.getElementById("book-grid");
  const emptyState = document.getElementById("empty-state");
  const visibleBooks = getVisibleBooks();

  grid.innerHTML = "";

  if (state.books.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  visibleBooks.forEach(book => {
    grid.appendChild(createSpineElement(book));
  });
}

function createSpineElement(book) {
  const spine = document.createElement("button");
  spine.type = "button";
  spine.className = "book-spine";
  spine.style.background = colorForBookId(book.id);
  spine.setAttribute("aria-label", book.title);
  spine.addEventListener("click", () => openDetailModal(book.id));

  const titleSpan = document.createElement("span");
  titleSpan.className = "book-spine-title";
  const fontSizePx = fontSizeForTitle(book.title, book.subtitle);
  titleSpan.style.fontSize = `${fontSizePx}px`;

  const mainText = document.createElement("span");
  mainText.className = "spine-title-main";
  mainText.textContent = book.title;
  titleSpan.appendChild(mainText);

  if (book.subtitle) {
    // タイトルのつぎに続けて表示。<br>で区切ることで、サブタイトルは
    // タイトルの折り返し状況に関係なく必ず新しい列から始まる
    titleSpan.appendChild(document.createElement("br"));
    const subText = document.createElement("span");
    subText.className = "spine-title-sub";
    subText.textContent = book.subtitle;
    titleSpan.appendChild(subText);
  }

  // 1列の高さ＝「タイトルとサブタイトルのうち長い方」を基準に、
  // 15文字ぶんを上限にして計算（短い本は短く、長い本は15文字で折り返す）
  const longestSegment = Math.max(book.title.length, book.subtitle ? book.subtitle.length : 0);
  const effectiveChars = Math.max(5, Math.min(longestSegment, SPINE_WRAP_CHAR_COUNT));
  const columnHeightPx = Math.round(effectiveChars * fontSizePx * SPINE_LINE_HEIGHT);
  titleSpan.style.height = `${columnHeightPx}px`;

  // 背表紙全体の横幅は、必要な列数から自分で計算して明示的に指定する。
  // （ブラウザの「中身に合わせて幅を決める」機能は、縦書き文字だと
  //   実際より狭く見積もってしまうことがあり、右側に文字がはみ出す原因になるため）
  const titleColumns = Math.max(1, Math.ceil(book.title.length / effectiveChars));
  const subtitleColumns = book.subtitle ? Math.max(1, Math.ceil(book.subtitle.length / effectiveChars)) : 0;
  const totalColumns = titleColumns + subtitleColumns;
  const columnWidthPx = fontSizePx * SPINE_LINE_HEIGHT;
  const SPINE_HORIZONTAL_PADDING_PX = 16; // CSSのpadding左右ぶん
  const SPINE_WIDTH_SAFETY_MARGIN_PX = 14; // 見切れないための余裕
  const spineWidthPx = Math.round(totalColumns * columnWidthPx) + SPINE_HORIZONTAL_PADDING_PX + SPINE_WIDTH_SAFETY_MARGIN_PX;
  spine.style.width = `${spineWidthPx}px`;

  spine.appendChild(titleSpan);

  if (book.protected) {
    const lock = document.createElement("span");
    lock.className = "spine-lock";
    lock.textContent = "🔒";
    spine.appendChild(lock);
  }

  if (book.reread) {
    const bookmark = document.createElement("span");
    bookmark.className = "spine-bookmark";
    const color = state.settings.rereadColors[book.rereadColorSlot - 1] || "#ffffff";
    bookmark.style.setProperty("--bookmark-color", color);
    spine.appendChild(bookmark);
  }

  return spine;
}

// ---------------------------------------------------------
// 7. 検索・並び替え・絞り込み（イベント）
// ---------------------------------------------------------

function renderSearchSuggestions(inputValue) {
  const list = document.getElementById("search-suggestions");
  list.innerHTML = "";

  if (!inputValue) {
    list.hidden = true;
    return;
  }

  const q = inputValue.toLowerCase();
  // タイトルのみが対象（サブタイトルは対象外）。重複タイトルは1つにまとめる。
  const uniqueTitles = [...new Set(state.books.map(b => b.title))]
    .filter(title => title.toLowerCase().includes(q))
    .slice(0, 8);

  if (uniqueTitles.length === 0) {
    list.hidden = true;
    return;
  }

  uniqueTitles.forEach(title => {
    const li = document.createElement("li");
    li.textContent = title;
    li.addEventListener("click", () => {
      document.getElementById("search-input").value = title;
      list.hidden = true;
    });
    list.appendChild(li);
  });
  list.hidden = false;
}

function runSearch() {
  const input = document.getElementById("search-input");
  state.searchQuery = input.value.trim();
  document.getElementById("search-suggestions").hidden = true;
  renderBookGrid();

  // 「さがした」ことが子どもにわかるようにフィードバックを出す
  const count = getVisibleBooks().length;
  if (state.searchQuery) {
    showToast(count > 0 ? `${count}さつ\nみつかったよ！` : "みつからなかったよ");
  }
}

// ---------------------------------------------------------
// 8. 詳細モーダル（閲覧⇔編集）
// ---------------------------------------------------------

function openDetailModal(bookId) {
  state.currentBookId = bookId;
  const book = state.books.find(b => b.id === bookId);
  if (!book) return;

  switchToViewMode();
  renderDetailView(book);
  document.getElementById("modal-detail").hidden = false;
}

function closeDetailModal() {
  document.getElementById("modal-detail").hidden = true;
  state.currentBookId = null;
}

function switchToViewMode() {
  document.getElementById("view-mode").hidden = false;
  document.getElementById("edit-mode").hidden = true;
}

function switchToEditMode() {
  document.getElementById("view-mode").hidden = true;
  document.getElementById("edit-mode").hidden = false;
}

function renderDetailView(book) {
  document.getElementById("detail-title-view").textContent = book.title;
  document.getElementById("detail-subtitle-view").textContent = book.subtitle;
  document.getElementById("detail-volume-view").textContent = `${book.volume}かん`;
  document.getElementById("detail-author-view").textContent = book.author || "-";
  document.getElementById("detail-protect-view").textContent = book.protected ? "🔒 まもっている" : "まもっていない";

  const lastRead = getLastReadDate(book);
  document.getElementById("detail-lastread-view").textContent =
    lastRead ? formatDateJp(lastRead) : "まだよんでいないよ";
  document.getElementById("detail-count-view").textContent = `${book.readCount}かい`;
  // 記録が無いときは取り消すものが無いので、取り消しボタンごと隠す
  document.getElementById("btn-undo-read").hidden = !lastRead;

  // さいどく表示
  if (book.reread) {
    const color = state.settings.rereadColors[book.rereadColorSlot - 1] || "#ffffff";
    document.getElementById("detail-reread-view").innerHTML =
      `🔖 している <span style="display:inline-block;width:14px;height:14px;border-radius:4px;border:2px solid #ccc;background:${color};vertical-align:middle;margin-left:4px;"></span>`;
  } else {
    document.getElementById("detail-reread-view").textContent = "していない";
  }

  // お気に入り表示：使用中のマークを5段階ぶんくり返し、
  // 選んだ段階まで色つき、残りはグレー・うすめで表示
  const favWrap = document.getElementById("detail-favorite-view");
  favWrap.innerHTML = "";
  const activeMark = getActiveFavoriteMark();
  for (let level = 1; level <= 5; level++) {
    const span = document.createElement("span");
    span.textContent = activeMark.emoji;
    if (level > book.favoriteLevel) {
      span.style.opacity = "0.28";
      span.style.filter = "grayscale(1)";
    }
    favWrap.appendChild(span);
  }

  // 「よんだ！」用の日付は、モーダルを開いた瞬間はいつも今日にする
  state.pendingReadDate = todayStr();
  document.getElementById("read-date-input").value = state.pendingReadDate;
}

function openEditMode() {
  const book = state.books.find(b => b.id === state.currentBookId);
  if (!book) return;

  document.getElementById("edit-title").value = book.title;
  document.getElementById("edit-subtitle").value = book.subtitle;
  document.getElementById("edit-volume").value = book.volume;
  document.getElementById("edit-author").value = book.author;
  document.getElementById("edit-reread").checked = book.reread;
  document.getElementById("edit-protect").checked = book.protected;

  renderRereadColorSelect(book.rereadColorSlot);
  renderFavoritePicker(book.favoriteLevel);

  switchToEditMode();
}

function renderRereadColorSelect(selectedSlot) {
  const select = document.getElementById("edit-reread-color");
  select.innerHTML = "";
  for (let slot = 1; slot <= 7; slot++) {
    const option = document.createElement("option");
    option.value = String(slot);
    option.textContent = `いろ${slot}`;
    if (slot === selectedSlot) option.selected = true;
    select.appendChild(option);
  }
  updateRereadColorPreview();
  select.onchange = updateRereadColorPreview;
}

function updateRereadColorPreview() {
  const slot = Number(document.getElementById("edit-reread-color").value);
  const color = state.settings.rereadColors[slot - 1] || "#ffffff";
  document.getElementById("reread-color-preview").style.background = color;
}

// お気に入りの段階（0〜5）を選ぶピッカー。
// 使用中のマークだけを5個ならべ、タップした段階までを「選択中」にする。
// 選んでいる段階をもう一度タップすると0（未評価）に戻る。
function renderFavoritePicker(currentLevel) {
  const wrap = document.getElementById("edit-favorite-picker");
  wrap.innerHTML = "";
  wrap.dataset.currentLevel = String(currentLevel);
  const mark = getActiveFavoriteMark();

  for (let level = 1; level <= 5; level++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "favorite-picker-item" + (level <= currentLevel ? " is-selected" : "");
    btn.textContent = mark.emoji;
    btn.addEventListener("click", () => {
      const newLevel = (Number(wrap.dataset.currentLevel) === level) ? 0 : level;
      renderFavoritePicker(newLevel);
    });
    wrap.appendChild(btn);
  }
}

async function saveEditForm(event) {
  event.preventDefault();
  const book = state.books.find(b => b.id === state.currentBookId);
  if (!book) return;

  const favoriteWrap = document.getElementById("edit-favorite-picker");
  const favoriteLevel = Number(favoriteWrap.dataset.currentLevel || 0);

  const updated = {
    title: document.getElementById("edit-title").value.trim() || "（タイトルなし）",
    subtitle: document.getElementById("edit-subtitle").value.trim(),
    volume: Math.max(1, Number(document.getElementById("edit-volume").value) || 1),
    author: document.getElementById("edit-author").value.trim(),
    reread: document.getElementById("edit-reread").checked,
    rereadColorSlot: Number(document.getElementById("edit-reread-color").value),
    protected: document.getElementById("edit-protect").checked,
    favoriteLevel,
  };

  try {
    await updateDoc(doc(booksCollectionRef, book.id), updated);
    switchToViewMode();
    showToast("セーブしました！");
  } catch (err) {
    console.error("本の保存に失敗しました:", err);
    showToast("セーブに\nしっぱいしたみたい…");
  }
}

// ---------------------------------------------------------
// 9. 「よんだ！」の処理と演出
// ---------------------------------------------------------

async function handleReadButton() {
  const book = state.books.find(b => b.id === state.currentBookId);
  if (!book) return;

  const chosenDate = document.getElementById("read-date-input").value || todayStr();
  const alreadyHasThisDate = book.readHistory.some(entry => entry.date === chosenDate);

  if (alreadyHasThisDate) {
    openSameDayConfirm(async () => {
      await recordRead(book, chosenDate);
    });
  } else {
    await recordRead(book, chosenDate);
  }
}

async function recordRead(book, dateStr) {
  const newHistory = [...book.readHistory, { id: makeLocalId("read"), date: dateStr }];
  const newCount = book.readCount + 1;

  try {
    await updateDoc(doc(booksCollectionRef, book.id), {
      readHistory: newHistory,
      readCount: newCount,
    });
    playReadEffect(newCount);
  } catch (err) {
    console.error("よんだ記録の保存に失敗しました:", err);
    showToast("きろくの保存に\nしっぱいしたみたい…");
  }
}

// 「さいごによんだひ」に表示されている記録だけをピンポイントで取り消す
// （間違えて登録したときに、その1件だけ消して回数も1つ戻すためのもの）
async function undoLastRead() {
  const book = state.books.find(b => b.id === state.currentBookId);
  if (!book) return;

  const entryToRemove = getLastReadEntry(book);
  if (!entryToRemove) return;

  const newHistory = book.readHistory.filter(entry => entry.id !== entryToRemove.id);
  const newCount = Math.max(0, book.readCount - 1);

  try {
    await updateDoc(doc(booksCollectionRef, book.id), {
      readHistory: newHistory,
      readCount: newCount,
    });
    showToast("きろくをとりけしたよ");
  } catch (err) {
    console.error("記録の取り消しに失敗しました:", err);
    showToast("とりけしに\nしっぱいしたみたい…");
  }
}

function playReadEffect(count) {
  const layer = document.getElementById("read-effect-layer");
  document.getElementById("read-effect-count").textContent = `${count}かいよんだ！`;
  layer.hidden = false;
  window.setTimeout(() => { layer.hidden = true; }, 1400);
}

let sameDayConfirmCallback = null;
function openSameDayConfirm(onYes) {
  sameDayConfirmCallback = onYes;
  document.getElementById("modal-confirm-sameday").hidden = false;
}
function closeSameDayConfirm() {
  document.getElementById("modal-confirm-sameday").hidden = true;
  sameDayConfirmCallback = null;
}

// ---------------------------------------------------------
// 10. コピー・削除・新規追加
// ---------------------------------------------------------

// タイトルが完全一致する本の中から、いちばん大きい巻数を探して+1する
function nextVolumeForTitle(title) {
  const sameTitleBooks = state.books.filter(b => b.title === title);
  if (sameTitleBooks.length === 0) return 1;
  const maxVolume = Math.max(...sameTitleBooks.map(b => b.volume));
  return maxVolume + 1;
}

async function copyCurrentBook() {
  const book = state.books.find(b => b.id === state.currentBookId);
  if (!book) return;

  const newBook = {
    title: book.title,
    subtitle: "",                 // サブタイトルはコピーしない
    volume: nextVolumeForTitle(book.title),
    author: book.author,
    protected: book.protected,
    reread: false,
    rereadColorSlot: 1,
    favoriteLevel: 0,
    readCount: 0,                 // 読了回数はコピーしない
    readHistory: [],              // 読了履歴はコピーしない
    createdAt: Date.now(),
  };

  try {
    await addDoc(booksCollectionRef, newBook);
    closeDetailModal();
    showToast("コピーしました！");
  } catch (err) {
    console.error("コピーに失敗しました:", err);
    showToast("コピーに\nしっぱいしたみたい…");
  }
}

async function deleteCurrentBook() {
  const book = state.books.find(b => b.id === state.currentBookId);
  if (!book) return;

  if (book.protected) {
    showToast("🔒\nロックがかかってるよ！\nけしたいときは本のかぎをはずしてね😊");
    return;
  }

  try {
    await deleteDoc(doc(booksCollectionRef, book.id));
    closeDetailModal();
  } catch (err) {
    console.error("さくじょに失敗しました:", err);
    showToast("さくじょに\nしっぱいしたみたい…");
  }
}

async function createNewBook(title) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;

  const newBook = {
    title: trimmedTitle,
    subtitle: "",
    volume: 1,
    author: "",
    protected: true,
    reread: false,
    rereadColorSlot: 1,
    favoriteLevel: 0,
    readCount: 0,
    readHistory: [],
    createdAt: Date.now(),
  };

  try {
    await addDoc(booksCollectionRef, newBook);
    showToast("本をついかしたよ！");
  } catch (err) {
    console.error("本の追加に失敗しました:", err);
    showToast("本の追加に\nしっぱいしたみたい…");
  }
}

// ---------------------------------------------------------
// 11. トースト表示（中央・2〜3秒）
// ---------------------------------------------------------

let toastTimer = null;
function showToast(message, durationMs = 2400) {
  const toast = document.getElementById("toast");
  document.getElementById("toast-message").textContent = message;
  toast.hidden = false;

  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, durationMs);
}

// ---------------------------------------------------------
// 12. 設定モーダルの描画
// ---------------------------------------------------------

function renderSettingsModal() {
  // お気に入りマーク一覧（候補の中から使うものを1つ選ぶ）
  const markList = document.getElementById("favorite-mark-list");
  markList.innerHTML = "";
  state.settings.favoriteMarks.forEach((mark) => {
    const li = document.createElement("li");
    li.className = "settings-mark-item";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "active-favorite-mark";
    radio.className = "mark-active-radio";
    radio.checked = mark.id === state.settings.activeFavoriteMarkId;
    radio.setAttribute("aria-label", `${mark.emoji} をつかう`);
    radio.addEventListener("change", () => setActiveFavoriteMark(mark.id));

    const emojiSpan = document.createElement("span");
    emojiSpan.className = "mark-emoji";
    emojiSpan.textContent = mark.emoji;

    const posSpan = document.createElement("span");
    posSpan.className = "mark-position";
    posSpan.textContent = mark.id === state.settings.activeFavoriteMarkId ? "いまつかっているマーク" : "";

    const removeBtn = document.createElement("button");
    removeBtn.className = "settings-remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeFavoriteMark(mark.id));

    li.append(radio, emojiSpan, posSpan, removeBtn);
    markList.appendChild(li);
  });

  // さいどく色一覧（1〜7固定）
  const colorList = document.getElementById("reread-color-list");
  colorList.innerHTML = "";
  for (let slot = 1; slot <= 7; slot++) {
    const li = document.createElement("li");
    li.className = "settings-color-item";

    const numSpan = document.createElement("span");
    numSpan.className = "color-slot-number";
    numSpan.textContent = slot;

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = state.settings.rereadColors[slot - 1] || "#ffffff";
    colorInput.addEventListener("input", () => setRereadColor(slot - 1, colorInput.value));

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "color-clear-btn";
    clearBtn.textContent = "白にもどす";
    clearBtn.addEventListener("click", () => {
      colorInput.value = "#ffffff";
      setRereadColor(slot - 1, null);
    });

    li.append(numSpan, colorInput, clearBtn);
    colorList.appendChild(li);
  }
}

// ---------------------------------------------------------
// 13. 画面部品とイベントの登録（アプリの起動処理）
// ---------------------------------------------------------

function bindEvents() {
  // 検索
  const searchInput = document.getElementById("search-input");
  searchInput.addEventListener("input", () => renderSearchSuggestions(searchInput.value.trim()));
  searchInput.addEventListener("focus", () => renderSearchSuggestions(searchInput.value.trim()));
  document.getElementById("btn-search").addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  // 検索欄の外をタップしたらサジェストを閉じる
  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".search-input-wrap");
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById("search-suggestions").hidden = true;
    }
  });

  // 並び替え
  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.sortKey = e.target.value;
    renderBookGrid();
  });

  // 絞り込み（セグメント）
  document.querySelectorAll(".segmented-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".segmented-btn").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.filterKey = btn.dataset.filter;
      renderBookGrid();
    });
  });

  // モーダルを閉じる共通ボタン（✕）
  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".modal-overlay").hidden = true;
      if (btn.closest("#modal-detail")) state.currentBookId = null;
    });
  });

  // 詳細モーダルの各ボタン
  document.getElementById("btn-edit").addEventListener("click", openEditMode);
  document.getElementById("btn-cancel-edit").addEventListener("click", switchToViewMode);
  document.getElementById("edit-form").addEventListener("submit", saveEditForm);
  document.getElementById("btn-copy").addEventListener("click", copyCurrentBook);
  document.getElementById("btn-delete").addEventListener("click", deleteCurrentBook);
  document.getElementById("btn-read-today").addEventListener("click", handleReadButton);
  document.getElementById("btn-undo-read").addEventListener("click", undoLastRead);
  document.getElementById("read-date-input").addEventListener("change", (e) => {
    state.pendingReadDate = e.target.value;
  });

  // 同じ日付の確認モーダル
  document.getElementById("btn-sameday-yes").addEventListener("click", () => {
    const cb = sameDayConfirmCallback;
    closeSameDayConfirm();
    if (cb) cb();
  });
  document.getElementById("btn-sameday-no").addEventListener("click", closeSameDayConfirm);

  // 追加（＋ボタン）
  document.getElementById("btn-add-book").addEventListener("click", () => {
    document.getElementById("add-title").value = "";
    document.getElementById("modal-add").hidden = false;
  });
  document.getElementById("btn-cancel-add").addEventListener("click", () => {
    document.getElementById("modal-add").hidden = true;
  });
  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("add-title").value;
    await createNewBook(title);
    document.getElementById("modal-add").hidden = true;
  });

  // 設定モーダル
  document.getElementById("btn-open-settings").addEventListener("click", () => {
    renderSettingsModal();
    document.getElementById("modal-settings").hidden = false;
  });
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    document.getElementById("modal-settings").hidden = true;
  });
  document.getElementById("btn-add-favorite-mark").addEventListener("click", () => {
    const input = document.getElementById("new-favorite-mark");
    addFavoriteMark(input.value.trim());
    input.value = "";
  });
}

// ---------------------------------------------------------
// アプリ起動（合言葉ゲート → メイン画面）
// ---------------------------------------------------------

async function startApp(passphrase) {
  setupFirestoreRefs(passphrase);
  document.getElementById("gate-screen").hidden = true;
  document.getElementById("app-root").hidden = false;

  // ボタンなどの操作は、データ取得の成否にかかわらず必ず先に使えるようにする
  // （こうしておくと、もしFirestoreの読み込みに失敗しても「何も反応しない」状態にならず、
  //   下のトーストでエラーに気づける）
  bindEvents();

  try {
    await loadSettingsOnce();
  } catch (err) {
    console.error("せっていの読み込みに失敗しました:", err);
    showToast("せっていの読みこみに\nしっぱいしたみたい…");
  }

  try {
    subscribeToBooks();
  } catch (err) {
    console.error("本のデータ取得に失敗しました:", err);
    showToast("本のデータの読みこみに\nしっぱいしたみたい…");
  }
}

function bindGateEvents() {
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-input");
  const errorText = document.getElementById("gate-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorText.hidden = true;

    const enteredPassphrase = input.value;
    const enteredHash = await sha256Hex(enteredPassphrase);
    if (enteredHash === CORRECT_PASSPHRASE_HASH) {
      // Firestoreのパスには平文の合言葉を使うので、平文のまま保存しておく
      window.localStorage.setItem(AUTH_STORAGE_KEY, enteredPassphrase);
      await startApp(enteredPassphrase);
    } else {
      errorText.hidden = false;
      input.value = "";
      input.focus();
    }
  });
}

async function init() {
  bindGateEvents();

  // 前回すでに合言葉が合っていれば自動で入る
  const storedPassphrase = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (storedPassphrase) {
    const storedHash = await sha256Hex(storedPassphrase);
    if (storedHash === CORRECT_PASSPHRASE_HASH) {
      await startApp(storedPassphrase);
    }
  }
  // 合っていなければ、ゲート画面（合言葉入力）を表示したまま待つ
}

init();
