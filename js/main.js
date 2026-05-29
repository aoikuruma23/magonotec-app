/**
 * まごのTEC メインスクリプト
 * STEP1: 静的UI骨組み
 * STEP2: 画面切り替えロジック
 * STEP3: メッセージ管理・送信機能
 * STEP4: 高齢者向けテキスト整形・まご口調
 * STEP5: ガイド画面（使い方・家族の方へ）
 * STEP6: チャットヘルパー（カテゴリチップUI）
 * STEP7: キャラクター表情切り替え
 * STEP9: バックエンドAPI連携（/api/chat）
 * STEP11: 会話履歴（history）を活用
 * STEP12: 軽い話しかけ（アイボ風オート挨拶）
 * STEP13: 季節別・絵文字入り挨拶テンプレート
 * STEP14: シニア向け「かんたん設定」機能
 * STEP15: 画像共有機能（スクショ送信）
 * STEP16: 音声入力機能（Web Speech API）
 * STEP17: 会話履歴の永続化（localStorage）
 * STEP17b: 家族課金ペアリング（?pair=パラメータ）
 * STEP19: 感情フレーバー（名前呼び）機能
 *   - 記念日トリガー（1/1, 3/3, 12/24, 12/31）
 *   - 久しぶりトリガー（3日/7日/14日以上）
 *   - 別れ際トリガー（ばいばい/またね/さよなら/おやすみ/終わり）
 *   - 日常の愛着ワンフレーズ（10%確率、1日1回制限）
 *
 * このファイルでは画面遷移とメッセージ管理のロジックを実装。
 */

// ============================================
// API設定
// ============================================

/**
 * バックエンドAPIのベースURL
 * 本番環境では適切なURLに変更すること
 */
const API_BASE_URL = 'https://magonotec-api.onrender.com';

/**
 * STEP18: 登録ページURL（PAYMENT_LINKではなくregister.htmlへ誘導）
 */
const REGISTER_URL = 'https://aoikuruma23.github.io/magonotec-app/register.html';

// ============================================
// STEP17b: 家族課金ペアリング
// ============================================

/**
 * localStorageのキー（ペアリングID）
 */
const STORAGE_KEY_PAIRING_ID = 'magonotec_pairing_id';

/**
 * STEP19: localStorageのキー（ニックネーム）
 */
const STORAGE_KEY_SENIOR_NAME = 'magonotec_senior_name';

/**
 * URLパラメータからpairing_idを取得し、localStorageに保存
 * STEP19: senior_nameも保存
 * @returns {string|null} pairing_id
 */
function initPairing() {
  const urlParams = new URLSearchParams(window.location.search);
  const pairParam = urlParams.get('pair');
  const nameParam = urlParams.get('name');

  if (pairParam) {
    // URLにpair=がある場合、localStorageに保存
    localStorage.setItem(STORAGE_KEY_PAIRING_ID, pairParam);
    console.log('ペアリングIDを保存しました:', pairParam);

    // STEP19: ニックネームも保存
    if (nameParam) {
      localStorage.setItem(STORAGE_KEY_SENIOR_NAME, nameParam);
      console.log('ニックネームを保存しました:', nameParam);
    }

    // URLからパラメータを削除（見た目をクリーンに）
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return localStorage.getItem(STORAGE_KEY_PAIRING_ID);
}

/**
 * 現在のpairing_idを取得
 * @returns {string|null}
 */
function getPairingId() {
  return localStorage.getItem(STORAGE_KEY_PAIRING_ID);
}

/**
 * STEP17-B: 有効なペアリングがあるかチェック
 * @returns {boolean}
 */
function hasValidPairing() {
  const pairingId = getPairingId();
  return pairingId !== null && pairingId.length > 0;
}

/**
 * STEP17-B: 未登録メッセージを表示（API呼び出しなし）
 */
function showUnregisteredMessage() {
  const messageText = 'このチャットは、ご家族の登録が必要だよ。\n\n届いたリンクから開いてね。\n\nわからなければ、ご家族に聞いてみてね。';

  const unregisteredMessage = {
    id: generateId(),
    role: 'ai',
    text: formatForSenior(messageText),
    timestamp: getCurrentTimestamp(),
    showRegisterButton: true  // 登録ボタン表示フラグ
  };

  messages.push(unregisteredMessage);
  saveMessagesToStorage();
  renderMessages();

  // キャラを通常状態に
  setMascotState('normal');
}

/**
 * 利用日を記録するAPIを呼び出す
 * @param {string} pairingId
 */
async function recordUsage(pairingId) {
  try {
    await fetch(`${API_BASE_URL}/api/usage/record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pairing_id: pairingId }),
    });
    console.log('利用記録を送信しました');
  } catch (error) {
    // エラーは無視（ユーザー体験に影響させない）
    console.warn('利用記録の送信に失敗:', error);
  }
}

// ============================================
// STEP18: PWAインストール案内（ホーム画面に追加）
// ============================================

/**
 * PWAインストールプロンプト（Android Chrome用）
 * @type {BeforeInstallPromptEvent|null}
 */
let deferredInstallPrompt = null;

/**
 * インストール案内を表示済みかどうか
 */
const INSTALL_PROMPT_SHOWN_KEY = 'magonotec_install_prompt_shown';

/**
 * PWAがインストール済みかどうか
 */
function isPwaInstalled() {
  // スタンドアロンモードで動作中 = インストール済み
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

/**
 * iOSかどうか判定
 */
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * インストール案内を表示すべきか判定
 */
function shouldShowInstallPrompt() {
  // すでにインストール済みなら表示しない
  if (isPwaInstalled()) return false;

  // すでに案内済みなら表示しない
  if (localStorage.getItem(INSTALL_PROMPT_SHOWN_KEY) === 'true') return false;

  return true;
}

/**
 * ホーム画面追加の案内メッセージをチャットに表示
 */
function showInstallPromptMessage() {
  if (!shouldShowInstallPrompt()) return;

  // 案内済みフラグを立てる
  localStorage.setItem(INSTALL_PROMPT_SHOWN_KEY, 'true');

  const isIOSDevice = isIOS();

  // やさしい言葉で案内（デバイスによってメッセージを変える）
  let messageText = 'ねぇねぇ！\n\n';
  messageText += 'またいつでも会えるように、スマホのホーム画面にボタンを作っておこうか？\n\n';

  if (isIOSDevice) {
    messageText += 'やり方を教えるね。下のボタンを押してね 👇';
  } else {
    messageText += '下のボタンを押すと追加できるよ 👇';
  }

  const installMessage = {
    id: generateId(),
    role: 'ai',
    text: formatForSenior(messageText),
    timestamp: getCurrentTimestamp(),
    isInstallPrompt: true,  // 特別なメッセージとしてマーク
    isIOSDevice: isIOSDevice
  };

  messages.push(installMessage);
  saveMessagesToStorage();
  renderMessages();
}

/**
 * iOSの手順案内を表示
 */
function showIOSInstallGuide() {
  const guideText = '【ホーム画面への追加方法】\n\n' +
    '① 画面の下にある「共有ボタン」（□に↑マーク）を押してね\n\n' +
    '② 出てきたメニューを上にスクロールして「ホーム画面に追加」を押してね\n\n' +
    '③ 右上の「追加」を押したら完了だよ！\n\n' +
    'これでホーム画面からすぐ会えるようになるよ 😊';

  const guideMessage = {
    id: generateId(),
    role: 'ai',
    text: formatForSenior(guideText),
    timestamp: getCurrentTimestamp()
  };

  messages.push(guideMessage);
  saveMessagesToStorage();
  renderMessages();
}

/**
 * Androidのインストールを実行
 */
async function triggerAndroidInstall() {
  // プロンプトがまだ準備できていない場合は少し待つ
  if (!deferredInstallPrompt) {
    // 「準備中」メッセージを表示
    const waitMessage = {
      id: generateId(),
      role: 'ai',
      text: formatForSenior('ちょっと待ってね、準備しているよ... 🔄'),
      timestamp: getCurrentTimestamp()
    };
    messages.push(waitMessage);
    saveMessagesToStorage();
    renderMessages();

    // 最大3秒待ってリトライ
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (!deferredInstallPrompt) {
      // それでもない場合は手動案内
      const guideText = '【ホーム画面への追加方法】\n\n' +
        '① 画面右上の「︙」（メニュー）を押してね\n\n' +
        '② 「ホーム画面に追加」または「アプリをインストール」を押してね\n\n' +
        'これでホーム画面からすぐ会えるようになるよ 😊';

      const guideMessage = {
        id: generateId(),
        role: 'ai',
        text: formatForSenior(guideText),
        timestamp: getCurrentTimestamp()
      };

      messages.push(guideMessage);
      saveMessagesToStorage();
      renderMessages();
      return;
    }
  }

  // インストールプロンプトを表示
  deferredInstallPrompt.prompt();

  const result = await deferredInstallPrompt.userChoice;

  if (result.outcome === 'accepted') {
    const thankMessage = {
      id: generateId(),
      role: 'ai',
      text: formatForSenior('ありがとう！これでホーム画面からいつでも会えるね 😊'),
      timestamp: getCurrentTimestamp()
    };
    messages.push(thankMessage);
    saveMessagesToStorage();
    renderMessages();
  }

  deferredInstallPrompt = null;
}

/**
 * インストールボタンのクリックハンドラ
 */
function handleInstallButtonClick(isIOSDevice) {
  if (isIOSDevice) {
    showIOSInstallGuide();
  } else {
    triggerAndroidInstall();
  }
}

// beforeinstallpromptイベントをキャプチャ（Android Chrome用）
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('PWAインストールプロンプトをキャプチャしました');
});

// ============================================
// キャラクター表情管理
// ============================================

/**
 * キャラクターの状態と画像パスの対応
 * @type {Object.<string, string>}
 */
const MASCOT_STATES = {
  normal: 'assets/magonotec/character/hero_normal.png',      // 通常・待機
  thinking: 'assets/magonotec/character/hero_point_tip.png', // 考え中・AI返信待ち
  support: 'assets/magonotec/character/hero_nav_hand.png',   // サポート・案内中
  worried: 'assets/magonotec/character/hero_worried.png',    // 困惑・エラー時
  relieved: 'assets/magonotec/character/hero_relieved.png',  // 安心・返信完了
  bow: 'assets/magonotec/character/hero_bow.png',            // お辞儀・終了時
};

/**
 * キャラクターの表情（立ち絵）を切り替える
 *
 * スマホ版（767px以下）では、状態に応じて表示/非表示を制御：
 * - thinking: 非表示（ユーザーが吹き出しに集中できるように）
 * - relieved / normal / worried: 表示（右下に小さな顔アイコン）
 *
 * @param {string} state - MASCOT_STATES のキー（'normal', 'thinking', etc.）
 */
function setMascotState(state) {
  const img = document.getElementById('mascot-image');
  const container = document.getElementById('mascot-watcher');

  if (!img) {
    console.warn('マスコット画像要素が見つかりません');
    return;
  }

  // 表情（画像）を切り替え
  const src = MASCOT_STATES[state] || MASCOT_STATES.normal;
  img.src = src;
  img.dataset.state = state;
  console.log(`キャラ表情を変更: ${state}`);

  // ★ スマホ用の表示／非表示制御
  const isMobile = window.matchMedia('(max-width: 767px)').matches;

  if (container && isMobile) {
    if (state === 'thinking') {
      // AI考え中はマスコットを非表示にする
      container.classList.add('mascot--hidden');
    } else {
      // それ以外の状態では表示する
      container.classList.remove('mascot--hidden');
    }
  }
}

/*
 * ========================================
 * 将来の拡張用メモ（実装は今回不要）
 * ========================================
 *
 * - 設定画面またはメニューに「マスコット表示：ON/OFF」トグルを追加する
 * - ON/OFF 状態は localStorage などに保存し、
 *   起動時に読み込んで mascot-watcher の表示／非表示を切り替える
 *
 * 実装例:
 * const showMascot = localStorage.getItem('showMascot') !== 'false';
 * if (!showMascot) {
 *   document.getElementById('mascot-watcher').style.display = 'none';
 * }
 */

// ============================================
// メッセージデータ管理
// ============================================

/**
 * メッセージの型イメージ
 * @typedef {Object} Message
 * @property {string} id - ユニークID
 * @property {'user'|'ai'|'system'} role - メッセージの送信者
 * @property {string} text - メッセージ本文
 * @property {string} timestamp - 送信日時（'2025-12-07 01:23' 形式）
 */

/**
 * チャットメッセージを格納する配列
 * @type {Message[]}
 */
let messages = [];

/**
 * 当セッションで対話が開始されたか（チップ押下 or メッセージ送信）
 * アプリ起動毎に false にリセット → 起動直後は必ず相談開始カードが表示される
 * 「新しい相談を始める」でも false に戻る
 */
let chatInteractionStarted = false;

// ============================================
// STEP17: 会話履歴の永続化
// ============================================

/**
 * localStorageのキー
 */
const STORAGE_KEY_MESSAGES = 'magonotec_chat_history';

/**
 * 会話履歴をlocalStorageに保存
 */
function saveMessagesToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    console.log('会話履歴を保存しました');
  } catch (error) {
    console.error('会話履歴の保存に失敗:', error);
  }
}

/**
 * 会話履歴をlocalStorageから復元
 * @returns {boolean} 復元できたかどうか
 */
function loadMessagesFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MESSAGES);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        messages = parsed;
        console.log(`会話履歴を復元しました（${messages.length}件）`);
        return true;
      }
    }
  } catch (error) {
    console.error('会話履歴の復元に失敗:', error);
  }
  return false;
}

/**
 * 会話履歴をクリアして初期状態に戻す
 */
function clearChatHistory() {
  // localStorageから削除
  localStorage.removeItem(STORAGE_KEY_MESSAGES);

  // STEP18: インストール案内フラグもリセット（再度案内が出るように）
  localStorage.removeItem(INSTALL_PROMPT_SHOWN_KEY);

  // メッセージを初期化
  initializeMessages();

  // 対話開始フラグをリセット → 相談開始カード再表示
  chatInteractionStarted = false;

  // 画面を更新
  renderMessages();

  console.log('会話履歴をクリアしました');
}

// ============================================
// STEP15: 画像共有（スクショ送信）
// ============================================

/**
 * 送信待ちの画像（Base64形式、data:プレフィックスなし）
 * @type {string|null}
 */
let pendingImage = null;

/**
 * リトライ用: 最後のリクエストパラメータ
 */
let lastRequestText = null;
let lastRequestImage = null;

/**
 * 画像アップロード機能のセットアップ
 */
function setupImageUpload() {
  const btnAttach = document.getElementById('btn-attach-image');
  const fileInput = document.getElementById('image-file-input');
  const btnRemove = document.getElementById('btn-remove-image');

  if (!btnAttach || !fileInput) {
    console.warn('画像アップロード要素が見つかりません');
    return;
  }

  // 画像添付ボタンをクリック → 隠しファイル入力をトリガー
  btnAttach.addEventListener('click', () => {
    fileInput.click();
  });

  // ファイル選択時の処理
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleImageSelect(file);
    }
    // 同じファイルを再選択できるようにリセット
    fileInput.value = '';
  });

  // 画像削除ボタン
  if (btnRemove) {
    btnRemove.addEventListener('click', () => {
      clearPendingImage();
    });
  }

  console.log('画像アップロード機能セットアップ完了');
}

/**
 * 選択された画像をBase64に変換してプレビュー表示
 * @param {File} file - 選択された画像ファイル
 */
function handleImageSelect(file) {
  // 画像ファイルかチェック
  if (!file.type.startsWith('image/')) {
    console.warn('画像ファイルではありません:', file.type);
    return;
  }

  const reader = new FileReader();

  reader.onload = (e) => {
    const dataUrl = e.target.result; // "data:image/jpeg;base64,..."
    // data:プレフィックスを除去してBase64部分のみ保存
    const base64 = dataUrl.split(',')[1];
    pendingImage = base64;

    // プレビュー表示
    showImagePreview(dataUrl);
    console.log('画像を選択しました');
  };

  reader.onerror = () => {
    console.error('画像の読み込みに失敗しました');
  };

  reader.readAsDataURL(file);
}

/**
 * 画像プレビューを表示
 * @param {string} dataUrl - 画像のData URL
 */
function showImagePreview(dataUrl) {
  const previewArea = document.getElementById('image-preview-area');
  const previewImg = document.getElementById('image-preview');

  if (previewArea && previewImg) {
    previewImg.src = dataUrl;
    previewArea.style.display = 'block';
  }
}

/**
 * 送信待ち画像をクリア
 */
function clearPendingImage() {
  pendingImage = null;

  const previewArea = document.getElementById('image-preview-area');
  const previewImg = document.getElementById('image-preview');

  if (previewArea) {
    previewArea.style.display = 'none';
  }
  if (previewImg) {
    previewImg.src = '';
  }

  console.log('画像をクリアしました');
}

// ============================================
// STEP16: 音声入力機能（Web Speech API）
// ============================================

/**
 * SpeechRecognition インスタンス
 * @type {SpeechRecognition|null}
 */
let recognition = null;

/**
 * 録音中フラグ
 * @type {boolean}
 */
let isRecording = false;

/**
 * 音声入力機能のセットアップ
 */
function setupVoiceInput() {
  const micButton = document.querySelector('.mic-button');

  if (!micButton) {
    console.warn('マイクボタンが見つかりません');
    return;
  }

  // Web Speech API の対応チェック
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('このブラウザは音声認識に対応していません');
    // 非対応ブラウザではボタンを無効化
    micButton.disabled = true;
    micButton.style.opacity = '0.5';
    micButton.title = 'このブラウザは音声入力に対応していません';
    return;
  }

  // SpeechRecognition インスタンスを作成
  recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';           // 日本語
  recognition.continuous = false;        // 1発話で自動停止
  recognition.interimResults = false;    // 確定結果のみ

  // 認識結果を受け取ったとき
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('音声認識結果:', transcript);
    handleVoiceResult(transcript);
  };

  // 認識終了時（自動停止含む）
  recognition.onend = () => {
    console.log('音声認識終了');
    stopVoiceRecognition();
  };

  // エラー時
  recognition.onerror = (event) => {
    console.error('音声認識エラー:', event.error);
    stopVoiceRecognition();

    if (event.error === 'not-allowed') {
      alert('マイクの使用が許可されていません。\nブラウザの設定でマイクを許可してください。');
    } else if (event.error === 'no-speech') {
      // 無音の場合は何もしない（静かに終了）
    } else {
      console.warn('音声認識でエラーが発生しました:', event.error);
    }
  };

  // マイクボタンのクリックイベント
  micButton.addEventListener('click', () => {
    if (isRecording) {
      stopVoiceRecognition();
    } else {
      startVoiceRecognition();
    }
  });

  console.log('音声入力機能セットアップ完了');
}

/**
 * 音声認識を開始
 */
function startVoiceRecognition() {
  if (!recognition || isRecording) return;

  try {
    recognition.start();
    isRecording = true;

    // マイクボタンを録音中スタイルに
    const micButton = document.querySelector('.mic-button');
    if (micButton) {
      micButton.classList.add('recording');
    }

    console.log('音声認識開始');
  } catch (error) {
    console.error('音声認識開始エラー:', error);
    isRecording = false;
  }
}

/**
 * 音声認識を停止
 */
function stopVoiceRecognition() {
  if (!recognition) return;

  try {
    recognition.stop();
  } catch (error) {
    // すでに停止している場合は無視
  }

  isRecording = false;

  // マイクボタンを通常スタイルに戻す
  const micButton = document.querySelector('.mic-button');
  if (micButton) {
    micButton.classList.remove('recording');
  }

  console.log('音声認識停止');
}

/**
 * 音声認識結果を入力欄に反映
 * @param {string} text - 認識されたテキスト
 */
function handleVoiceResult(text) {
  const messageInput = document.getElementById('message-input');

  if (messageInput && text) {
    // 既存のテキストがあれば末尾に追加、なければそのまま入力
    if (messageInput.value.trim()) {
      messageInput.value += ' ' + text;
    } else {
      messageInput.value = text;
    }

    // 入力欄にフォーカス
    messageInput.focus();
  }
}

// ============================================
// STEP12: オート挨拶（アイボ風）状態管理
// ============================================

/**
 * 最後にユーザーがメッセージを送信した時刻
 * @type {Date|null}
 */
let lastUserMessageAt = null;

/**
 * オート挨拶チェック用のタイマーID
 * @type {number|null}
 */
let autoGreetingTimerId = null;

/**
 * オート挨拶の最小間隔（分）
 * ユーザーの最終発話からこの時間が経過するまで話しかけない
 */
const MIN_INTERVAL_MINUTES = 180; // 3時間

// ============================================
// STEP14: かんたん設定
// ============================================

/**
 * オート挨拶が有効かどうか（設定から制御）
 * @type {boolean}
 */
let AUTO_GREETING_ENABLED = true;

/**
 * 設定をlocalStorageから読み込む
 * @returns {{autoGreeting: string, mascotVisible: string, fontSize: string}}
 */
function loadSettings() {
  return {
    autoGreeting: localStorage.getItem('magonotec_setting_autoGreeting') || 'on',
    mascotVisible: localStorage.getItem('magonotec_setting_mascotVisible') || 'on',
    fontSize: localStorage.getItem('magonotec_setting_fontSize') || 'normal'
  };
}

/**
 * 設定をlocalStorageに保存する
 * @param {{autoGreeting: string, mascotVisible: string, fontSize: string}} settings
 */
function saveSettings(settings) {
  localStorage.setItem('magonotec_setting_autoGreeting', settings.autoGreeting);
  localStorage.setItem('magonotec_setting_mascotVisible', settings.mascotVisible);
  localStorage.setItem('magonotec_setting_fontSize', settings.fontSize);
}

/**
 * 設定を画面に適用する
 * @param {{autoGreeting: string, mascotVisible: string, fontSize: string}} settings
 */
function applySettings(settings) {
  // 1) オート挨拶の有効/無効
  AUTO_GREETING_ENABLED = (settings.autoGreeting === 'on');

  // 2) マスコット表示
  const mascotContainer = document.querySelector('.mascot-watcher');
  if (mascotContainer) {
    if (settings.mascotVisible === 'off') {
      mascotContainer.classList.add('mascot--hidden-force');
    } else {
      mascotContainer.classList.remove('mascot--hidden-force');
    }
  }

  // 3) 文字サイズ
  const chatScreen = document.getElementById('screen-chat');
  if (chatScreen) {
    chatScreen.dataset.fontSize = settings.fontSize;
  }
}

/**
 * 設定モーダルのUIを初期化
 * @param {{autoGreeting: string, mascotVisible: string, fontSize: string}} initial
 */
function setupSettingsUI(initial) {
  const modal = document.getElementById('settings-modal');
  const btnOpen = document.getElementById('btn-open-settings');
  const btnClose = document.getElementById('btn-settings-close');
  const backdrop = document.getElementById('settings-modal-backdrop');

  if (!modal || !btnOpen || !btnClose) return;

  // 初期値をラジオボタンに反映
  const autoGreetingRadio = document.querySelector(`input[name="autoGreeting"][value="${initial.autoGreeting}"]`);
  const mascotVisibleRadio = document.querySelector(`input[name="mascotVisible"][value="${initial.mascotVisible}"]`);
  const fontSizeRadio = document.querySelector(`input[name="fontSize"][value="${initial.fontSize}"]`);

  if (autoGreetingRadio) autoGreetingRadio.checked = true;
  if (mascotVisibleRadio) mascotVisibleRadio.checked = true;
  if (fontSizeRadio) fontSizeRadio.checked = true;

  // モーダルを開く
  btnOpen.addEventListener('click', () => {
    modal.setAttribute('aria-hidden', 'false');
  });

  // モーダルを閉じる（設定を保存して適用）
  const closeModal = () => {
    const settings = {
      autoGreeting: document.querySelector('input[name="autoGreeting"]:checked')?.value || 'on',
      mascotVisible: document.querySelector('input[name="mascotVisible"]:checked')?.value || 'on',
      fontSize: document.querySelector('input[name="fontSize"]:checked')?.value || 'normal'
    };

    saveSettings(settings);
    applySettings(settings);
    modal.setAttribute('aria-hidden', 'true');
  };

  btnClose.addEventListener('click', closeModal);

  // 背景クリックでも閉じる
  if (backdrop) {
    backdrop.addEventListener('click', closeModal);
  }
}

/**
 * 季節を判定する
 * @param {Date} date - 判定対象の日付
 * @returns {'spring'|'summer'|'autumn'|'winter'} 季節
 */
function getSeason(date) {
  const month = date.getMonth() + 1; // 0-indexed → 1-indexed
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter'; // 12, 1, 2月
}

/**
 * 朝の挨拶テンプレート（季節別）
 * STEP13: 絵文字入り・自然な日本語
 */
const MORNING_GREETINGS = {
  winter: [
    'おはようございます❄️ 今日は冷えるので、あたたかくしてお過ごしくださいね☕',
    'おはようございます⛄ 冷たい空気ですね。ゆっくり始めていきましょう✨'
  ],
  spring: [
    'おはようございます🌸 今日は気温が上がりそうです。気持ちよく過ごせますように✨',
    'おはようございます😊 花粉が気になる時期ですね。無理せず過ごしてくださいね🍃'
  ],
  summer: [
    'おはようございます🌻 暑くなりそうです。こまめに水分とってくださいね💧',
    'おはようございます☀️ 日差しが強いので、外出するときは気をつけてくださいね✨'
  ],
  autumn: [
    'おはようございます🍁 朝は少し涼しいですね。羽織るものがあると安心ですよ😊',
    'おはようございます✨ 空気が乾燥してきました。喉を大切にしてくださいね🌿'
  ]
};

/**
 * 夕方の挨拶テンプレート（季節別）
 * STEP13: 絵文字入り・自然な日本語
 */
const EVENING_GREETINGS = {
  winter: [
    '今日も一日おつかれさまでした❄️ あたたかくしてお休みくださいね😊',
    '日が暮れるのが早いですね⛄ ゆっくり過ごしてくださいね✨'
  ],
  spring: [
    '今日もおつかれさまでした🌸 夕方は少し冷えますので気をつけてくださいね🍃',
    'おつかれさまです😊 風が強い日みたいなので、外出時は気をつけてくださいね🌼'
  ],
  summer: [
    '今日も暑かったですね🌻 夕方でも水分とると楽になりますよ💧',
    '蒸し暑い一日でしたね💦 お風呂でゆっくりするのも良いかもしれません😊'
  ],
  autumn: [
    '今日もおつかれさまでした🍁 夕方の風が気持ちいいですね✨',
    '乾燥する季節ですね🌙 あたたかい飲み物でほっとしてくださいね🍵'
  ]
};

/**
 * オート挨拶のセットアップ
 * チャット画面表示時に呼び出す
 */
function setupAutoGreetings() {
  // 既存タイマーがあればクリア
  if (autoGreetingTimerId) {
    clearInterval(autoGreetingTimerId);
  }

  // 5分ごとにチェック
  autoGreetingTimerId = setInterval(checkAutoGreeting, 5 * 60 * 1000);

  // 画面を開いた直後にも一度チェック
  checkAutoGreeting();

  console.log('オート挨拶セットアップ完了');
}

/**
 * オート挨拶のクリーンアップ
 * チャット画面を離れるときに呼び出す
 */
function cleanupAutoGreetings() {
  if (autoGreetingTimerId) {
    clearInterval(autoGreetingTimerId);
    autoGreetingTimerId = null;
  }
  console.log('オート挨拶クリーンアップ完了');
}

/**
 * 現在時刻がどの挨拶スロットに該当するか判定
 * @param {Date} now - 現在時刻
 * @returns {'morning'|'evening'|null}
 */
function getGreetingSlot(now) {
  const hour = now.getHours();
  if (hour >= 10 && hour <= 11) return 'morning';
  if (hour >= 16 && hour <= 18) return 'evening';
  return null;
}

/**
 * 今日の挨拶済みキーを生成
 * @param {string} slot - 'morning' or 'evening'
 * @returns {string} 例: '2025-12-08_morning'
 */
function getTodayGreetingKey(slot) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `magonotec_greeting_${yyyy}-${mm}-${dd}_${slot}`;
}

/**
 * オート挨拶のチェックと送信
 */
function checkAutoGreeting() {
  // STEP14: 設定でOFFなら何もしない
  if (!AUTO_GREETING_ENABLED) {
    console.log('オート挨拶: 設定でOFF');
    return;
  }

  const now = new Date();

  // どの時間帯スロットか判定
  const slot = getGreetingSlot(now);
  if (!slot) {
    console.log('オート挨拶: 時間帯外');
    return;
  }

  // すでに今日そのスロットで挨拶済みなら何もしない
  const todayKey = getTodayGreetingKey(slot);
  if (localStorage.getItem(todayKey) === 'sent') {
    console.log(`オート挨拶: ${slot}は送信済み`);
    return;
  }

  // 直近3時間以内にユーザーが発話していたらスキップ
  if (lastUserMessageAt) {
    const diffMs = now - lastUserMessageAt;
    const diffMin = diffMs / (1000 * 60);
    if (diffMin < MIN_INTERVAL_MINUTES) {
      console.log(`オート挨拶: 直近${Math.round(diffMin)}分前に発話あり、スキップ`);
      return;
    }
  }

  // 軽い挨拶を送る
  sendAutoGreeting(slot);

  // 今日の挨拶済みフラグを立てる
  localStorage.setItem(todayKey, 'sent');
  console.log(`オート挨拶: ${slot}を送信、フラグ保存`);
}

/**
 * オート挨拶メッセージを送信
 * @param {'morning'|'evening'} slot - 時間帯スロット
 */
function sendAutoGreeting(slot) {
  // 季節を判定
  const season = getSeason(new Date());

  // 時間帯と季節に応じたテンプレートを取得
  const templates = slot === 'morning'
    ? MORNING_GREETINGS[season]
    : EVENING_GREETINGS[season];

  // ランダムに1つ選択
  const text = templates[Math.floor(Math.random() * templates.length)];

  // AI側メッセージとして追加
  const greetingMessage = {
    id: generateId(),
    role: 'ai',
    text: formatForSenior(text),
    timestamp: getCurrentTimestamp()
  };
  messages.push(greetingMessage);

  // 描画を更新
  renderMessages();

  // キャラを通常状態に
  setMascotState('normal');

  console.log(`オート挨拶送信 [${season}/${slot}]: ${text}`);
}

// ============================================
// STEP19: 感情フレーバー（名前呼び）機能
// ============================================

/**
 * STEP19: 最終会話日のlocalStorageキー
 */
const STORAGE_KEY_LAST_TALK_DATE = 'magonotec_last_talk_date';

/**
 * STEP19: 感情フレーバー使用済みフラグのキープレフィックス
 */
const STORAGE_KEY_EMOTION_USED_PREFIX = 'emotion_used_';
const STORAGE_KEY_ANNIV_USED_PREFIX = 'emotion_anniv_used_';

/**
 * STEP19: ニックネームを取得する
 * @returns {string} ニックネーム（未設定なら空文字）
 */
function getSeniorName() {
  return localStorage.getItem(STORAGE_KEY_SENIOR_NAME) || '';
}

/**
 * STEP19: 確率で名前を使うか判断する（40%）
 * @returns {boolean}
 */
function shouldUseName() {
  return Math.random() < 0.4;
}

/**
 * STEP19: 今日の日付をYYYY-MM-DD形式で取得
 * @returns {string}
 */
function getTodayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * STEP19: その日のフレーバー使用済みかチェック
 * @param {string} prefix - キープレフィックス
 * @returns {boolean}
 */
function isEmotionUsedToday(prefix = STORAGE_KEY_EMOTION_USED_PREFIX) {
  const key = prefix + getTodayDateString();
  return localStorage.getItem(key) === 'used';
}

/**
 * STEP19: その日のフレーバー使用済みフラグを立てる
 * @param {string} prefix - キープレフィックス
 */
function markEmotionUsedToday(prefix = STORAGE_KEY_EMOTION_USED_PREFIX) {
  const key = prefix + getTodayDateString();
  localStorage.setItem(key, 'used');
}

/**
 * STEP19: 記念日メッセージを取得（該当日のみ）
 * @returns {string|null}
 */
function getAnniversaryGreeting() {
  // 今日すでに記念日メッセージを出した場合はスキップ
  if (isEmotionUsedToday(STORAGE_KEY_ANNIV_USED_PREFIX)) {
    return null;
  }

  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const dateKey = `${month}/${day}`;

  const name = getSeniorName();
  const useName = shouldUseName() && name;

  // 記念日テンプレート
  const anniversaryMessages = {
    '1/1': useName
      ? `${name}、あけましておめでとう🎍\n今年も、気が向いたらお話しようね。`
      : 'あけましておめでとう🎍\n今年も気が向いたらお話しようね。',
    '3/3': useName
      ? `ひな祭りだね🌸\n${name}、今日はやさしい気分で話そ。`
      : 'ひな祭りだね🌸\n今日はやさしい気分で話そ。',
    '12/24': useName
      ? `${name}、メリークリスマス🎄\n今日も少しお話できたらうれしいな。`
      : 'メリークリスマス🎄\n今日も少しお話できたらうれしいな。',
    '12/31': useName
      ? `大晦日だね。\n今年いちばん良かったのは、${name}とお話できたこと。ありがとう😊`
      : '大晦日だね。\n今年もお話できてありがとう😊'
  };

  const message = anniversaryMessages[dateKey];
  if (message) {
    markEmotionUsedToday(STORAGE_KEY_ANNIV_USED_PREFIX);
    return message;
  }

  return null;
}

/**
 * STEP19: 久しぶりメッセージを取得（会話間隔トリガー）
 * @returns {string|null}
 */
function getLongtimeNoSeeGreeting() {
  // 今日すでにフレーバーを出した場合はスキップ
  if (isEmotionUsedToday()) {
    return null;
  }

  const lastTalkDate = localStorage.getItem(STORAGE_KEY_LAST_TALK_DATE);
  if (!lastTalkDate) {
    return null;
  }

  // 日数差を計算（時刻は使わない）
  const today = new Date(getTodayDateString());
  const last = new Date(lastTalkDate);
  const diffMs = today - last;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 3) {
    return null;
  }

  const name = getSeniorName();
  const useName = shouldUseName() && name;

  let message = null;

  if (diffDays >= 14) {
    message = useName
      ? `${name}、今日は会えてちょっと特別な気分だよ。`
      : '今日は会えてちょっと特別な気分だよ。';
  } else if (diffDays >= 7) {
    message = useName
      ? `久しぶりだね、${name}。今日もゆっくり話そ。`
      : '久しぶりだね。今日もゆっくり話そ。';
  } else if (diffDays >= 3) {
    message = useName
      ? `${name}、また話せてうれしいな😊`
      : 'また話せてうれしいな😊';
  }

  if (message) {
    markEmotionUsedToday();
  }

  return message;
}

/**
 * STEP19: 別れ際の追加文を取得
 * @param {string} userText - ユーザーの入力テキスト
 * @returns {string|null}
 */
function getFarewellAddition(userText) {
  if (!userText) return null;

  // 別れ際ワード
  const farewellWords = ['ばいばい', 'またね', 'さよなら', 'おやすみ', '終わり', 'ありがとう'];
  const lowerText = userText.toLowerCase();

  const isFarewell = farewellWords.some(word => lowerText.includes(word));
  if (!isFarewell) {
    return null;
  }

  const name = getSeniorName();
  const useName = shouldUseName() && name;

  // 別れ際の追加文（ランダムで名前入り/なし）
  if (useName) {
    return `\n\n${name}、お話できて楽しかったよ。\nまた、気が向いたら来てね😊`;
  } else {
    return '\n\nお話できて楽しかったよ。\nまた、気が向いたら来てね😊';
  }
}

/**
 * STEP19: 日常の愛着ワンフレーズを取得（10%確率、1日1回）
 * @returns {string|null}
 */
function getRandomAffectionPhrase() {
  // 今日すでにフレーバーを出した場合はスキップ
  if (isEmotionUsedToday()) {
    return null;
  }

  // 10%の確率
  if (Math.random() >= 0.10) {
    return null;
  }

  const name = getSeniorName();
  const useName = shouldUseName() && name;

  // 愛着フレーズ候補
  const phrases = useName
    ? [
        `${name}、いつでもここにいるよ。`,
        '話してくれてありがとう😊',
        '今日もえらいね。'
      ]
    : [
        'いつでもここにいるよ。',
        '話してくれてありがとう😊',
        '今日もえらいね。'
      ];

  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  markEmotionUsedToday();

  return '\n\n' + phrase;
}

/**
 * STEP19: 最終会話日を更新
 */
function updateLastTalkDate() {
  localStorage.setItem(STORAGE_KEY_LAST_TALK_DATE, getTodayDateString());
}

/**
 * STEP19: AIの返信に感情フレーバーを付加する（統合関数）
 *
 * 優先順位:
 * 1. 記念日トリガー（初回のみ、返信の前に表示）
 * 2. 久しぶりトリガー（初回のみ、返信の前に表示）
 * 3. 別れ際トリガー（該当時、返信の後に追加）
 * 4. 日常の愛着フレーズ（10%確率、返信の後に追加）
 *
 * @param {string} replyText - AIの返信テキスト
 * @param {string} userText - ユーザーの入力テキスト
 * @param {boolean} isFirstReplyOfDay - その日の初回AI返信かどうか
 * @returns {{prefixMessage: string|null, modifiedReply: string}}
 */
function maybeAddEmotionFlavor(replyText, userText, isFirstReplyOfDay) {
  let prefixMessage = null;
  let modifiedReply = replyText;

  // 1. 記念日トリガー（その日の初回のみ）
  if (isFirstReplyOfDay) {
    const annivMsg = getAnniversaryGreeting();
    if (annivMsg) {
      prefixMessage = annivMsg;
    }
  }

  // 2. 久しぶりトリガー（その日の初回のみ、記念日がなければ）
  if (isFirstReplyOfDay && !prefixMessage) {
    const longtimeMsg = getLongtimeNoSeeGreeting();
    if (longtimeMsg) {
      prefixMessage = longtimeMsg;
    }
  }

  // 3. 別れ際トリガー（必ず追加）
  const farewellAdd = getFarewellAddition(userText);
  if (farewellAdd) {
    modifiedReply = replyText + farewellAdd;
  }

  // 4. 日常の愛着フレーズ（別れ際でない場合のみ、10%確率）
  if (!farewellAdd) {
    const affectionAdd = getRandomAffectionPhrase();
    if (affectionAdd) {
      modifiedReply = replyText + affectionAdd;
    }
  }

  return { prefixMessage, modifiedReply };
}

/**
 * STEP19: その日の初回AI返信かどうかを判定
 * @returns {boolean}
 */
function isFirstAiReplyOfDay() {
  const lastTalkDate = localStorage.getItem(STORAGE_KEY_LAST_TALK_DATE);
  const today = getTodayDateString();
  return lastTalkDate !== today;
}

// ============================================
// ユーティリティ関数
// ============================================

/**
 * ユニークIDを生成する
 * @returns {string}
 */
function generateId() {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 現在時刻をフォーマットして返す
 * @returns {string} 'YYYY-MM-DD HH:MM' 形式
 */
function getCurrentTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 初期メッセージを設定する
 */
function initializeMessages() {
  // 初期メッセージもフォーマットを適用
  const greeting1 = formatForSenior('こんにちは！まごのTECだよ。');
  const greeting2 = formatForSenior('スマホやネットのことで、なにか困ってない？なんでも気軽に聞いてね。');

  messages = [
    {
      id: generateId(),
      role: 'ai',
      text: greeting1,
      timestamp: getCurrentTimestamp()
    },
    {
      id: generateId(),
      role: 'ai',
      text: greeting2,
      timestamp: getCurrentTimestamp()
    }
  ];
}

// ============================================
// テキスト整形（高齢者向け）
// ============================================

/**
 * 高齢の方でも読みやすいように、文単位で改行を入れる
 *
 * 整形ルール：
 * - 「。」「？」「！」の直後で文を区切る
 * - 読点（、）では改行しない
 * - 文字数による改行は行わない
 * - 各文の間に1行の空行を挿入する
 *
 * @param {string} text - 整形前のテキスト
 * @returns {string} - 整形後のテキスト（空行区切り）
 */
function formatForSenior(text) {
  // 「。」「？」「！」の直後で分割（区切り文字を保持）
  const sentences = text.split(/(?<=[。？！])/);

  // 各文をtrim、空文字は除外
  const result = sentences
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // 文と文の間に空行を挿入
  return result.join('\n\n');
}

// ============================================
// ローディング表示
// ============================================

const LOADING_INDICATOR_ID = 'loading-indicator';

/**
 * ローディング表示を追加
 */
function showLoadingIndicator() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  // 既存のローディング表示があれば削除
  hideLoadingIndicator();

  // ローディング用の吹き出しを作成
  const loadingBubble = document.createElement('div');
  loadingBubble.id = LOADING_INDICATOR_ID;
  loadingBubble.className = 'message-bubble ai loading';
  loadingBubble.innerHTML = '<p class="loading-text">考え中<span class="loading-dots"></span></p>';

  container.appendChild(loadingBubble);

  // スクロール
  scrollToBottom();
}

/**
 * ローディング表示を削除
 */
function hideLoadingIndicator() {
  const loadingElement = document.getElementById(LOADING_INDICATOR_ID);
  if (loadingElement) {
    loadingElement.remove();
  }
}

// ============================================
// メッセージ描画
// ============================================

/**
 * messages 配列の内容を画面に描画する
 */
function renderMessages() {
  // ヘルパー表示はコンテナ有無に依存しないので先に必ず実行
  updateChatHelperVisibility();

  const container = document.getElementById('chat-messages');
  if (!container) {
    console.error('メッセージコンテナが見つかりません');
    return;
  }

  // コンテナをクリア
  container.innerHTML = '';

  // 各メッセージを描画
  messages.forEach((msg) => {
    const bubbleEl = createMessageBubble(msg);
    container.appendChild(bubbleEl);
  });

  // 描画後にスクロール
  scrollToBottom();
}

/**
 * 当セッションのフラグに従ってチャットヘルパーカードの表示を切り替える
 * - chatInteractionStarted === false なら表示（初回起動、新しい相談押下後）
 * - チップ押下 or 送信ボタン押下で true → CSS で非表示
 * - 過去の messages.length に依存しない（オート挨拶や localStorage 残骸の影響を受けない）
 */
function updateChatHelperVisibility() {
  const chatScreen = document.getElementById('screen-chat');
  if (!chatScreen) return;

  if (chatInteractionStarted) {
    chatScreen.classList.add('screen--chat-active');
  } else {
    chatScreen.classList.remove('screen--chat-active');
  }
}

/**
 * メッセージオブジェクトから吹き出し要素を生成する
 * @param {Message} msg
 * @returns {HTMLElement}
 */
function createMessageBubble(msg) {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.dataset.messageId = msg.id;

  // roleに応じてクラスを追加
  if (msg.role === 'ai') {
    bubble.classList.add('ai');
  } else if (msg.role === 'user') {
    bubble.classList.add('user');
  } else if (msg.role === 'system') {
    bubble.classList.add('system');
  }

  // 画像があれば表示（ユーザーメッセージの場合）
  if (msg.image) {
    const img = document.createElement('img');
    img.src = msg.image;
    img.alt = '送信した画像';
    img.className = 'message-image';
    bubble.appendChild(img);
  }

  // テキストを<p>タグで囲む（改行は<br>に変換）
  if (msg.text) {
    const p = document.createElement('p');
    p.innerHTML = escapeHtml(msg.text).replace(/\n/g, '<br>');
    bubble.appendChild(p);
  }

  // STEP18: インストール案内の場合はボタンを追加
  if (msg.isInstallPrompt) {
    const button = document.createElement('button');
    button.className = 'install-prompt-button';
    // iOSは手動手順が必要なのでボタン文言を変える
    button.textContent = msg.isIOSDevice
      ? '📖 やり方を見る'
      : '🏠 ホーム画面に追加する';
    button.addEventListener('click', () => {
      handleInstallButtonClick(msg.isIOSDevice);
    });
    bubble.appendChild(button);
  }

  // リトライボタンを追加（エラー時）
  if (msg.showRetry) {
    const retryButton = document.createElement('button');
    retryButton.className = 'retry-button';
    retryButton.textContent = '🔄 もう一度試す';
    retryButton.addEventListener('click', () => {
      retryLastRequest();
    });
    bubble.appendChild(retryButton);
  }

  // STEP18: 登録ページボタン（未登録ユーザー向け）
  if (msg.showRegisterButton) {
    const registerButton = document.createElement('button');
    registerButton.className = 'register-button';
    registerButton.textContent = '📝 登録ページを開く';
    registerButton.addEventListener('click', () => {
      window.open(REGISTER_URL, '_blank');
    });
    bubble.appendChild(registerButton);
  }

  return bubble;
}

/**
 * 最後のリクエストをリトライする
 */
function retryLastRequest() {
  if (!lastRequestText && !lastRequestImage) {
    console.warn('リトライするリクエストがありません');
    return;
  }

  // エラーメッセージを削除（showRetryフラグがあるメッセージ）
  const errorMsgIndex = messages.findIndex(msg => msg.showRetry);
  if (errorMsgIndex !== -1) {
    messages.splice(errorMsgIndex, 1);
  }

  // 画面を更新
  renderMessages();

  // 再度APIを呼び出す
  scheduleAiReply(lastRequestText, lastRequestImage);
}

/**
 * HTMLエスケープ処理
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// メッセージ送信処理
// ============================================

/**
 * ユーザーのメッセージを処理する
 * @param {string} text - ユーザーが入力したテキスト
 */
function handleUserMessage(text) {
  // 空文字チェック（STEP15: 画像がある場合は空文字でもOK）
  const trimmedText = text.trim();
  if (!trimmedText && !pendingImage) {
    return;
  }

  // 対話開始フラグを立てる（相談開始カードを非表示に）
  chatInteractionStarted = true;

  // STEP17-B: ペアリングチェック（未登録なら送信ブロック）
  if (!hasValidPairing()) {
    // ユーザーの入力は表示する
    const userMessage = {
      id: generateId(),
      role: 'user',
      text: trimmedText || '（画像を送信しました）',
      timestamp: getCurrentTimestamp(),
      image: pendingImage ? `data:image/jpeg;base64,${pendingImage}` : null
    };
    messages.push(userMessage);
    clearInput();
    clearPendingImage();

    // 未登録メッセージを表示（API呼び出しなし）
    showUnregisteredMessage();
    return;
  }

  // ユーザーメッセージを追加（フォーマットは適用しない）
  // STEP15: 画像がある場合はその旨を表示
  let displayText = trimmedText || '';
  if (pendingImage && !trimmedText) {
    displayText = '（画像を送信しました）';
  }

  const userMessage = {
    id: generateId(),
    role: 'user',
    text: displayText,
    timestamp: getCurrentTimestamp(),
    // 画像があれば Data URL として保存（チャット履歴に表示用）
    image: pendingImage ? `data:image/jpeg;base64,${pendingImage}` : null
  };
  messages.push(userMessage);

  // STEP17: 会話履歴を保存
  saveMessagesToStorage();

  // STEP12: 最終発話時刻を更新（オート挨拶の制御用）
  lastUserMessageAt = new Date();

  // 描画を更新
  renderMessages();

  // 入力欄をクリア
  clearInput();

  // キャラを「考え中」状態に
  setMascotState('thinking');

  // STEP15: 画像を一時保存してからクリア（API呼び出しに渡すため）
  const imageToSend = pendingImage;
  clearPendingImage();

  // バックエンドAPIからAI返信を取得
  scheduleAiReply(trimmedText, imageToSend);
}

/**
 * バックエンドAPIからAI返信を取得する
 * /api/chat エンドポイントを呼び出し、返信を表示する
 *
 * STEP11: 会話履歴（history）を送信して、話のつながりを保つ
 * - 直近12件の履歴を送信
 * - 最新のユーザー発話は history には含めず message のみに入れる
 *
 * STEP15: 画像がある場合は image パラメータも送信
 *
 * @param {string} userText - ユーザーの入力テキスト
 * @param {string|null} image - Base64エンコードされた画像（オプション）
 */
async function scheduleAiReply(userText, image = null) {
  // リトライ用にパラメータを保存
  lastRequestText = userText;
  lastRequestImage = image;

  // ローディング表示を追加
  showLoadingIndicator();

  try {
    // キャラを「考え中」状態に（handleUserMessageでも設定しているが、念のため）
    setMascotState('thinking');

    // 会話履歴を構築（直近12件に制限）
    // 注意: この時点で messages[] には今回のユーザー発話が既に追加されている
    // そのため、最後の1件（今回の発話）を除いた履歴を送る
    const MAX_HISTORY_ITEMS = 12;
    const historyForApi = messages
      .slice(0, -1)  // 最後の1件（今回のユーザー発話）を除く
      .slice(-MAX_HISTORY_ITEMS)  // 直近12件に制限
      .map(msg => ({
        role: msg.role,
        content: msg.text
      }));

    // STEP15: リクエストボディを構築（画像がある場合は含める）
    // STEP17-B: pairing_idを必ず含める
    const pairingId = getPairingId();
    const requestBody = {
      message: userText,
      history: historyForApi,
      pairing_id: pairingId,
    };
    if (image) {
      requestBody.image = image;
      console.log('画像付きリクエストを送信');
    }

    // STEP20: タイムアウト処理（60秒）
    const TIMEOUT_MS = 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // APIを呼び出す
    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // レスポンスチェック
    if (!response.ok) {
      // STEP19: レート制限エラーの場合は特別なメッセージ
      if (response.status === 429) {
        throw new Error('RATE_LIMIT');
      }
      // 400 (pairing_id欠如/形式不正) / 403 (有効なsubscriptionなし) は未登録導線へ
      if (response.status === 400 || response.status === 403) {
        throw new Error('UNREGISTERED');
      }
      throw new Error(`API error: ${response.status}`);
    }

    // JSONをパース
    const data = await response.json();
    const rawReply = data.reply || '教えてくれてありがとうだよ。もう一度、少しだけ教えてもらえるかな？';

    // STEP19: その日の初回AI返信かどうかを判定
    const isFirstReply = isFirstAiReplyOfDay();

    // STEP19: 感情フレーバーを適用
    const { prefixMessage, modifiedReply } = maybeAddEmotionFlavor(rawReply, userText, isFirstReply);

    // ローディング表示を消す
    hideLoadingIndicator();

    // STEP19: 記念日/久しぶりメッセージがあれば先に表示
    if (prefixMessage) {
      const prefixAiMessage = {
        id: generateId(),
        role: 'ai',
        text: formatForSenior(prefixMessage),
        timestamp: getCurrentTimestamp()
      };
      messages.push(prefixAiMessage);
    }

    // 高齢者向けフォーマットを適用
    const formattedReply = formatForSenior(modifiedReply);

    // メッセージを追加
    const aiMessage = {
      id: generateId(),
      role: 'ai',
      text: formattedReply,
      timestamp: getCurrentTimestamp()
    };
    messages.push(aiMessage);

    // STEP17: 会話履歴を保存
    saveMessagesToStorage();

    // STEP19: 最終会話日を更新
    updateLastTalkDate();

    // STEP17b: 利用記録を送信（ペアリング済みの場合）
    if (pairingId) {
      recordUsage(pairingId);
    }

    // 描画を更新
    renderMessages();

    // キャラを「安心」状態に（返信完了）
    setMascotState('relieved');

    // STEP18: 初回AI返信後にインストール案内を表示（少し間を置く）
    setTimeout(() => {
      showInstallPromptMessage();
    }, 2000);

  } catch (error) {
    console.error('scheduleAiReply error:', error);

    // ローディング表示を消す
    hideLoadingIndicator();

    // キャラを「困惑」状態に（エラー発生）
    setMascotState('worried');

    // STEP19-20: エラー種別に応じた専用メッセージ
    let fallbackText;
    let showRetry = false;
    let showRegisterButton = false;

    if (error.message === 'UNREGISTERED') {
      // 400/403: pairing_id無効・未登録など。固定文言で登録導線へ
      fallbackText = 'ご家族の登録が確認できなかったよ。\n\nわからなければ、ご家族に聞いてみてね。';
      showRegisterButton = true;
      // リトライボタンは出さない
    } else if (error.message === 'RATE_LIMIT') {
      fallbackText = 'ちょっと待ってね！\n\n' +
        'たくさんお話しすぎちゃったみたい。\n' +
        '1分くらい待ってから、また話しかけてね 😊';
      // レート制限の場合はリトライボタンを表示しない
    } else if (error.name === 'AbortError') {
      // STEP20: タイムアウトエラー
      fallbackText = 'ごめんね、ちょっと時間がかかりすぎちゃったみたい。\n\n' +
        '電波の調子が悪いのかもしれないね。\n' +
        'もう一度試してみてね 😊';
      showRetry = true;  // タイムアウトはリトライ可能
    } else {
      fallbackText = 'ごめんね。今は、うまくお返事ができなかったよ。';
      showRetry = true;  // その他のエラーはリトライ可能
    }
    const formattedFallback = formatForSenior(fallbackText);

    const fallbackMessage = {
      id: generateId(),
      role: 'ai',
      text: formattedFallback,
      timestamp: getCurrentTimestamp(),
      showRetry: showRetry,  // リトライボタン表示フラグ
      showRegisterButton: showRegisterButton  // 登録ボタン表示フラグ
    };
    messages.push(fallbackMessage);

    // 描画を更新
    renderMessages();
  }
}

/**
 * ダミーのAI返信テキストを生成する
 * 将来的にAPI応答に置き換え
 *
 * トーン：
 * - です・ます調ではなく、やさしい「だよ」「ね」口調
 * - 1メッセージ2〜3文
 * - 「共感 → 確認 → 提案」の流れ
 *
 * @param {string} userText - ユーザーの入力テキスト
 * @returns {string}
 */
function generateDummyReply(userText) {
  // まご口調のダミー返信パターン
  const replies = [
    'なるほどだよ。そういうとき、ちょっと不安になるよね。一緒に、ゆっくり見ていこうか。',
    '教えてくれてありがとう。まずは、今どんな画面が出ているかを、簡単に教えてもらえるかな？',
    '大丈夫だよ。失敗しても、ちゃんとやり直せるからね。少しずつ、順番にやってみよう。',
    'うんうん。そのあたり、分かりづらいよね。まずは、どのアプリのことかだけ教えてくれる？',
    '焦らなくて大丈夫だよ。ゆっくりでいいから、今困っていることを、一言で教えてくれるかな？',
    'そうなんだね。それは確かに困っちゃうよね。一緒に解決していこうね。',
    'わかったよ。じゃあ、まずは簡単なところから始めてみようか。ついてきてね。',
    'なるほどね。それなら、こうしてみるといいかもしれないよ。やってみようか？'
  ];

  const index = Math.floor(Math.random() * replies.length);
  return replies[index];
}

/**
 * 入力欄をクリアする
 */
function clearInput() {
  const input = document.getElementById('message-input');
  if (input) {
    input.value = '';
    input.focus();
  }
}

// ============================================
// 画面切り替え管理
// ============================================

/**
 * 指定したIDの画面を表示し、他の画面を非表示にする
 * @param {string} screenId - 表示する画面のID（'screen-home' or 'screen-chat'）
 */
function showScreen(screenId) {
  // STEP12: チャット画面を離れる場合はオート挨拶をクリーンアップ
  const currentChatScreen = document.getElementById('screen-chat');
  if (currentChatScreen && !currentChatScreen.classList.contains('screen--hidden') && screenId !== 'screen-chat') {
    cleanupAutoGreetings();
  }

  // すべての画面を非表示にする
  const screens = document.querySelectorAll('.screen');
  screens.forEach(screen => {
    screen.classList.add('screen--hidden');
  });

  // 指定した画面を表示する
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.classList.remove('screen--hidden');
    console.log(`画面を切り替えました: ${screenId}`);

    // チャット画面に切り替えた場合
    if (screenId === 'screen-chat') {
      // キャラを通常状態に
      setMascotState('normal');
      // メッセージを描画してスクロール
      renderMessages();
      // STEP12: オート挨拶をセットアップ
      setupAutoGreetings();
      // ヘルパー表示を確実に同期（renderMessages失敗時の保険）
      updateChatHelperVisibility();
    }
  } else {
    console.error(`画面が見つかりません: ${screenId}`);
  }
}

/**
 * 最新メッセージの先頭が見えるようにスクロールする
 */
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) {
    // 少し遅延させてDOMの更新を待つ
    setTimeout(() => {
      // 最後のメッセージ要素を取得
      const lastMessage = container.querySelector('.message-bubble:last-child');
      if (lastMessage) {
        // 先頭から読めるようにメッセージの頭に合わせてスクロール
        lastMessage.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
      } else {
        // メッセージがない場合は従来通り最下部へ
        container.scrollTop = container.scrollHeight;
      }
    }, 50);
  }
}

// ============================================
// イベントリスナーの設定
// ============================================

/**
 * 送信ボタンと入力欄のイベントを設定する
 */
function setupChatEvents() {
  const sendButton = document.querySelector('.send-button');
  const messageInput = document.getElementById('message-input');

  // 送信ボタンのクリック
  if (sendButton) {
    sendButton.addEventListener('click', () => {
      const text = messageInput ? messageInput.value : '';
      handleUserMessage(text);
    });
  }

  // Enterキーは改行（LINEと同じ挙動）
  // 送信は送信ボタンのみ
}

/**
 * 初期化処理
 */
function init() {
  console.log('まごのTEC を初期化しています...');

  // STEP17b: ペアリング処理（URLパラメータ ?pair= を確認）
  initPairing();

  // STEP17: 会話履歴を復元（なければ初期化）
  if (!loadMessagesFromStorage()) {
    initializeMessages();
  }

  // 初期画面をホーム画面に設定
  showScreen('screen-home');

  // 「困りごとを相談する」ボタンのイベント設定
  const btnStartChat = document.getElementById('btn-start-chat');
  if (btnStartChat) {
    btnStartChat.addEventListener('click', () => {
      // ホームから入場時は相談開始カードを再表示（指示書: 戻る/ホーム経由で再表示可）
      chatInteractionStarted = false;
      showScreen('screen-chat');
    });
  }

  // 「戻る」ボタンのイベント設定
  const btnBackHome = document.getElementById('btn-back-home');
  if (btnBackHome) {
    btnBackHome.addEventListener('click', () => {
      showScreen('screen-home');
    });
  }

  // チャット送信関連のイベント設定
  setupChatEvents();

  // ガイド画面へのナビゲーション設定
  setupGuideNavigation();

  // チャットヘルパー（カテゴリチップ）の設定
  setupChatHelperChips();

  // STEP14: かんたん設定の初期化
  const settings = loadSettings();
  applySettings(settings);
  setupSettingsUI(settings);

  // STEP15: 画像アップロード機能の初期化
  setupImageUpload();

  // STEP16: 音声入力機能の初期化
  setupVoiceInput();

  // STEP17: 新しい相談を始めるボタン（チャットヘルパー内のみ）
  const btnNewChat = document.getElementById('btn-new-chat');
  if (btnNewChat) {
    btnNewChat.addEventListener('click', () => {
      if (confirm('会話履歴をクリアして、新しい相談を始めますか？')) {
        clearChatHistory();
      }
    });
  }

  console.log('まごのTEC の初期化が完了しました');
}

/**
 * チャットヘルパーのチップ（カテゴリボタン）のイベントを設定する
 * チップを押すと、data-template の文字列が入力欄にセットされる
 *
 * 仕様：
 * - チップ押下時は入力欄を「上書き」する（既存テキストは消える）
 * - 入力欄にフォーカスを当てる
 * - 送信は行わない（書き始めのヒントとしての機能）
 */
function setupChatHelperChips() {
  const chips = document.querySelectorAll('.chat-helper__chips .chip');
  const messageInput = document.getElementById('message-input');

  if (!messageInput) {
    console.error('入力欄が見つかりません');
    return;
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const template = chip.dataset.template;
      if (template) {
        // 入力欄にテンプレートをセット（上書き）
        messageInput.value = template;
        // 入力欄にフォーカスを当てる
        messageInput.focus();
        // 対話開始フラグを立てて相談開始カードを即時非表示
        chatInteractionStarted = true;
        const chatScreen = document.getElementById('screen-chat');
        if (chatScreen) chatScreen.classList.add('screen--chat-active');
      }
    });
  });
}

/**
 * ガイド画面へのナビゲーションを設定する
 */
function setupGuideNavigation() {
  // 「まごのTECの使い方」リンク
  const linkHowto = document.getElementById('link-howto');
  if (linkHowto) {
    linkHowto.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('screen-howto');
    });
  }

  // 「家族の方へ」リンク
  const linkForFamily = document.getElementById('link-for-family');
  if (linkForFamily) {
    linkForFamily.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen('screen-for-family');
    });
  }

  // 使い方画面の「戻る」ボタン
  const btnBackFromHowto = document.getElementById('btn-back-from-howto');
  if (btnBackFromHowto) {
    btnBackFromHowto.addEventListener('click', () => {
      showScreen('screen-home');
    });
  }

  // 使い方画面の「ホームにもどる」ボタン
  const btnHomeFromHowto = document.getElementById('btn-home-from-howto');
  if (btnHomeFromHowto) {
    btnHomeFromHowto.addEventListener('click', () => {
      showScreen('screen-home');
    });
  }

  // 家族の方へ画面の「戻る」ボタン
  const btnBackFromFamily = document.getElementById('btn-back-from-family');
  if (btnBackFromFamily) {
    btnBackFromFamily.addEventListener('click', () => {
      showScreen('screen-home');
    });
  }

  // 家族の方へ画面の「ホームにもどる」ボタン
  const btnHomeFromFamily = document.getElementById('btn-home-from-family');
  if (btnHomeFromFamily) {
    btnHomeFromFamily.addEventListener('click', () => {
      showScreen('screen-home');
    });
  }
}

// DOMContentLoaded イベントで初期化
document.addEventListener('DOMContentLoaded', init);
