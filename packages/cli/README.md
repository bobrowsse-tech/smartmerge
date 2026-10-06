# SmartMergeResolver

The command is `smart-merge`. It needs Node.js 24 or newer.

```bash
npm install -g smart-merge-resolver
```

In a git repository that still has conflict markers:

```bash
smart-merge status
smart-merge resolve
smart-merge undo
```

`smart-merge status` lists the conflicts. `smart-merge resolve` shows a recommendation. Nothing is applied automatically. `smart-merge resolve --auto` applies only a resolution that is verified and marked certain. `smart-merge undo` restores the last backup.

The merge pipeline and the daemon inside this package are MPL-2.0. The rest of the command is Apache-2.0. Source: <https://github.com/bobrowsse-tech/smartmerge>.

Developed by [Bob Rowsse Walakira](https://bobrowsse.com). Contact: [hello@bobrowsse.com](mailto:hello@bobrowsse.com).
