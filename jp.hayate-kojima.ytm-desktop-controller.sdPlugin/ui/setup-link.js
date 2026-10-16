/**
 * すべてのアクションの Property Inspector の先頭に、前提条件の注意書きとお知らせを出す。
 * - お知らせ: リポジトリの notices.json をプラグイン側が読み、このアクションに該当するものを返す。
 * - 注意書き: API に届いていない(キーに Setup 警告が出ている)間だけ、手順へのリンクを添えて出す。
 * どちらもプラグインに getStatus を問い合わせ、返ってきた status で描画する。接続状態が
 * 変わった時はプラグイン側から status が送り直される。
 */
(() => {
	const SETUP_URL = "https://github.com/tuat-yate/ytm-desktop-controller#setup";

	// sdpi-components のフォント指定は各コンポーネントの Shadow DOM 内(--font-family)にあり、
	// 素の要素には継承されない。ラベル(Port: など)と同じ見た目にするためここで実値を書く。
	const style = document.createElement("style");
	style.textContent = `
		.sd-note {
			margin: 12px 8px 8px;
			padding: 8px 10px;
			border-left: 3px solid #E05656;
			border-radius: 3px;
			background-color: rgba(255, 255, 255, 0.07);
			color: #d8d8d8;
			font-family: "Segoe UI", Arial, Roboto, Helvetica, sans-serif;
			font-size: 9pt;
			line-height: 1.45;
		}
		.sd-note.warning {
			border-left-color: #E0A030;
		}
		.sd-note.info {
			border-left-color: #5A8FD8;
		}
		.sd-note a {
			color: #f28b8b;
			text-decoration: underline;
			cursor: pointer;
		}
		.sd-note.warning a {
			color: #f2c27a;
		}
		.sd-note.info a {
			color: #9cbff0;
		}
		.sd-note a:hover {
			filter: brightness(1.2);
		}
		.sd-note[hidden] {
			display: none;
		}
	`;
	document.head.appendChild(style);

	// PI 内の通常のリンクは既定ブラウザで開かないため、Stream Deck 本体に openUrl を投げる。
	const linkTo = (anchor, url) => {
		anchor.addEventListener("click", event => {
			event.preventDefault();
			window.SDPIComponents?.streamDeckClient.send("openUrl", { url });
		});
	};

	// どちらも設定項目より目立たせたいので先頭に置く。未接続なら他の何も動かないため、
	// 注意書きはお知らせよりさらに上にする。
	const notices = document.createElement("div");
	document.body.prepend(notices);

	const setupNote = document.createElement("div");
	setupNote.className = "sd-note";
	setupNote.hidden = true;
	setupNote.innerHTML =
		"<b>Cannot reach pear-desktop.</b> You need <b>pear-desktop v3.11.0+</b> running with the API Server plugin " +
		'enabled (authorization: none). For more detail, see the <a href="#">setup guide</a>.';
	linkTo(setupNote.querySelector("a"), SETUP_URL);
	document.body.prepend(setupNote);

	// notices.json の文面は textContent で入れ、HTML としては解釈しない。
	const renderNotices = list => {
		notices.replaceChildren(...list.map(notice => {
			const el = document.createElement("div");
			el.className = `sd-note ${notice.level === "info" ? "info" : "warning"}`;
			el.append(notice.message);
			if (notice.url) {
				const anchor = document.createElement("a");
				anchor.href = "#";
				anchor.textContent = "Details";
				linkTo(anchor, notice.url);
				el.append(" ", anchor);
			}
			return el;
		}));
	};

	const init = () => {
		const client = window.SDPIComponents?.streamDeckClient;
		if (!client) {
			setTimeout(init, 50);
			return;
		}
		client.sendToPropertyInspector.subscribe(message => {
			const payload = message?.payload;
			if (payload?.event !== "status") {
				return;
			}
			setupNote.hidden = payload.online !== false;
			renderNotices(Array.isArray(payload.notices) ? payload.notices : []);
		});
		// 接続完了を待ってから問い合わせる(早すぎると送信が捨てられる)。
		client.getConnectionInfo().then(() => client.send("sendToPlugin", { event: "getStatus" }));
	};
	init();
})();
