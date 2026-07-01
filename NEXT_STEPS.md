# protocol-radar 次にやること

要件定義: ~/Desktop/protocol-radar/docs/spec/
UI基準: docs/spec/02_DESIGN.md（トークンのみ・focus-visible必須・絵文字アイコン禁止・片側枠色禁止）
チーム編成: Lead(Opus) + Implementer3(Opus: core+watchers / webapi / agentapi) + Bug-hunter(Opus) + Integrator(Opus)
完走条件: 全P0機能が受け入れ条件合格 ＋ CI通過 ＋ main マージ

このシステムが何か（1行）:
  AIエージェント関連プロトコル（MCP / A2A / x402 / AP2 / UCP / A2UI / AG-UI / TAP / ANP / W3C標準）の
  「出た瞬間・変わった瞬間・消えた瞬間」を24時間観測し、改ざん不能なハッシュチェーン台帳に記録して、
  人間・API・AIエージェントの3経路に出す「最前線の生きた索引」。mcp-revenue-empire のエンジンを思想ごと流用。

既存サイトとの関係:
  別ドメイン・別ブランドで立てる（混ぜない）。mcp-revenue-empire は「信頼の証明」、本システムは「情報の速さ」。
  共有するのはコードのパターン（台帳・観測・差分・MCP/x402）だけ。

------------------------------------------------------------
■ 前提（初回だけ・両環境共通）
- Agent Teams 有効化済みか確認（~/.claude/settings.json に
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1）。未設定なら設定する。
- 本プロジェクトの Hooks は .claude/settings.json に同梱済み。
- gh（GitHub CLI）が認証済みか確認: gh auth status（PR自動マージに必須）。
- teammate 既定モデル: /config の Default teammate model を Opus に。
  （コスト優先なら実装3人だけ Sonnet、Lead/Bug-hunter は Opus 維持。台帳 F-002 は常に Opus）
- スタックは Next.js + TypeScript + SQLite。Node 18+ が必要。
- 環境変数: PROTOCOL_RADAR_HMAC_SECRET を設定（台帳の鍵。未設定だと F-002 はわざと失敗する）。
- 重要: 1セッション = 1チーム。複数システムを並行するなら案件ごとに別セッション（別フォルダ）。

------------------------------------------------------------
■ VSCode 拡張で進める場合
1. このフォルダで CC セッションを開く
   （ターミナル: cd ~/Desktop/protocol-radar && claude）
2. Hooks 反映のためセッションを開き直す（既存セッションには効かない）
3. 確認: /hooks で本プロジェクトの Hooks が出るか見る
4. docs/spec/99_EXECUTION.md の「lead launch prompt」をそのまま貼る
   ※ VSCode は in-process モード。teammate はパネルに並ぶ（上下矢印で選択→Enterで確認、xで停止）

------------------------------------------------------------
■ デスクトップ（Code タブ）で進める場合
1. Code タブ →「+ New session」→ フォルダに ~/Desktop/protocol-radar を選択
2. settings.json 共有なので VSCode と同じ Hooks/Agent Teams が効く
3. 採用機能:
   - Cloud(Remote): 環境ドロップダウンで Remote を選ぶ（PCを閉じても継続）。寝ている間の実装に最適。
   - auto-verify: 本プロジェクトは Web(Next.js)なので既定ON。埋め込みブラウザで自動検証。
     UI が 02_DESIGN.md 準拠かを目視確認できる。
   - PR 自動修正/マージ: PR 作成後の CI バーで Auto-fix / Auto-merge をオン
4. docs/spec/99_EXECUTION.md の「lead launch prompt」をそのまま貼る

------------------------------------------------------------
■ Cockpit Air で試す場合（Tom の狙い）
- 本パッケージはエンジン非依存（Agent Teams でも /batch でも動く）ので、Cockpit Air から
  このフォルダを開いて lead launch prompt を流す運用で問題ない。
- Cockpit Air 側で「寝ている間に走らせる」なら Cloud(Remote) を選んでおくと PC を閉じても継続する。

------------------------------------------------------------
■ teammate の動かし方（手動操作は不要）
lead launch prompt を1回貼れば、lead が implementer / bug-hunter / integrator を spawn →
割当 → レビュー → 完走まで回す。あなたの操作は「貼る」「たまに覗く」「最後にチェック」だけ。
- 動いている合図: 入力欄の下のエージェントパネルに teammate が並ぶ。
- 並ばない: Agent Teams 無効。CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 を確認して開き直す。
- 詰まり対処（そのまま打つ）:
  - 許可を何度も聞かれる → 設定で Auto モード（auto-mode-setup スキル）
  - lead が自分で実装し始めた → 「Wait for your teammates to finish」
  - 終わってないのに止まった → 「Keep going until all P0 are done」
  - UI が標準から外れた → 「Re-check against docs/spec/02_DESIGN.md and fix」
  - ソースURLを勝手に作った疑い → 「Validate every source URL; mark 404s inactive, never invent URLs」

■ 初回は練習してから（5分）
CC に貼る:「Spawn 2 teammates to review docs/spec and report any unclear acceptance
criteria. Have them challenge each other.」→ パネルに2人出て会話すれば仕組みは掴めている。

------------------------------------------------------------
■ チャットが重くなったら / 止まったら
- 重い: /compact（自動要約で継続）
- 使用量上限で停止: 枠回復後、同じフォルダで新セッションを開き、lead launch prompt を再投入。
  ※ in-process の teammate は /resume で戻らない → 再 spawn し progress.json の未完了から続ける。
- 別チャットへ移す: hikitsugi スキルで引き継ぎ資料を作る。

------------------------------------------------------------
■ あなたが最後にチェックすること（途中報告は読まなくてよい）
1. progress.json の stats: p0=17 が全部 completed か、ci_green=true、merged_to_main=true。
2. ローカル起動して目視:
   - ダッシュボードに各プロトコルのカードと鮮度バッジが出るか
   - 適当なプロトコル詳細でイベント時系列＋ハッシュバッジが出るか
   - /verify でOK表示が出るか（改ざんフィクスチャで tampered も出るか）
   - /timeline に全プロトコル横断の「最新の動き」が出るか
3. ソースURLの健全性: 起動ログに「fabricated URL」が無いこと、404は inactive 扱いになっていること。
4. UI: 片側だけ色の枠が無いか、絵文字アイコンが無いか、Tabキーで操作できるか。

問題があれば該当機能だけ dev-* / skill-improvement で個別対応。
