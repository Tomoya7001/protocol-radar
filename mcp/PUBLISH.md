# Protocol Radar — MCP 公式レジストリ提出手順

このドキュメントは、Protocol Radar のリモート MCP サーバーを
[公式 MCP レジストリ](https://registry.modelcontextprotocol.io)（`registry.modelcontextprotocol.io`）へ
提出するための手順をまとめたものです。

提出用の manifest は同ディレクトリの [`server.json`](./server.json) にあります。

> **重要 — owner 認証が必要:**
> 手順 2（`mcp-publisher login github`）と手順 3（`mcp-publisher publish`）は、
> GitHub アカウント **`Tomoya7001`** による OAuth 認証を必要とします。
> `io.github.tomoya7001/*` という名前空間は「その GitHub ユーザー本人であること」で
> 所有権が検証されるため、リポジトリ所有者本人が実行してください。
> 本準備作業ではファイルの用意までを行い、**実提出は行いません。**

## 前提

- このサーバーは **リモート MCP サーバー**です。本番エンドポイント
  `https://protocol-radar-lemon.vercel.app/api/mcp` が JSON-RPC 2.0（Streamable HTTP / JSON レスポンス方式）で
  すでに公開・稼働しています。npm 等へのパッケージ公開は不要で、レジストリにはメタデータのみを登録します。
- リモートサーバーは提出時点で **公開アクセス可能**である必要があります（上記 URL は稼働中）。
- GitHub アカウント（`Tomoya7001`）が必要です。

## server.json の主要フィールド

| フィールド | 値 |
| --- | --- |
| `$schema` | `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` |
| `name` | `io.github.tomoya7001/protocol-radar`（逆DNS形式。GitHub認証では `io.github.<username>/` で始まる必要あり） |
| `version` | `0.1.0`（サーバー実装の `SERVER_INFO.version` と一致） |
| `remotes[0].type` | `streamable-http` |
| `remotes[0].url` | `https://protocol-radar-lemon.vercel.app/api/mcp` |
| `repository` | `https://github.com/Tomoya7001/protocol-radar`（`source: github`） |

## 手順

### 1. `mcp-publisher` CLI をインストールする

macOS / Linux（プリビルドバイナリ）:

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

または Homebrew:

```bash
brew install mcp-publisher
```

インストール確認:

```bash
mcp-publisher --help
```

### 2. GitHub OAuth でレジストリに認証する（★owner 本人による認証が必要）

リポジトリ直下（`server.json` は `mcp/server.json` にあるため、下記のコマンドは
`mcp/` ディレクトリで実行するか、後述のとおり `publish` にパスを渡してください）で:

```bash
mcp-publisher login github
```

実行するとデバイスコードが表示されます。案内に従って
`https://github.com/login/device` を開き、表示されたコード（例: `ABCD-1234`）を入力し、
**GitHub アカウント `Tomoya7001`** でアプリを認可します。
`✓ Successfully logged in` と表示されれば成功です。

> 名前空間 `io.github.tomoya7001/protocol-radar` は、この GitHub ログインによって
> 「`Tomoya7001` 本人である」ことが検証されます。別アカウントでログインすると
> `You do not have permission to publish this server` で拒否されます。

### 3. レジストリへ提出する（★owner 認証済みの状態で実行）

`server.json` は `mcp/server.json` に配置してあります。`mcp-publisher publish` は
カレントディレクトリの `server.json` を読むため、`mcp/` ディレクトリで実行します:

```bash
cd mcp
mcp-publisher publish
```

成功すると次のような出力になります:

```text
Publishing to https://registry.modelcontextprotocol.io...
✓ Successfully published
✓ Server io.github.tomoya7001/protocol-radar version 0.1.0
```

### 4. 公開を確認する

レジストリ API を検索して、登録されたメタデータを確認します:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.tomoya7001/protocol-radar"
```

レスポンス JSON の `servers` 配列に `"name":"io.github.tomoya7001/protocol-radar"` を含む
エントリが返れば公開成功です。

## トラブルシューティング

| エラー | 対処 |
| --- | --- |
| `Invalid or expired Registry JWT token` | `mcp-publisher login github` で再認証する。 |
| `You do not have permission to publish this server` | GitHub 認証したユーザーが名前空間と一致していない。`io.github.tomoya7001/` は `Tomoya7001` 本人でログインする。 |
| リモート URL が到達不能 | `https://protocol-radar-lemon.vercel.app/api/mcp` が公開・稼働しているか確認する。 |

## 参考

- [Publishing Remote Servers](https://modelcontextprotocol.io/registry/remote-servers)
- [Quickstart: Publish a Server](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)
- server.json スキーマ: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
