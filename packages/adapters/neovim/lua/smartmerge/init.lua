local rpc = require("smartmerge.rpc")

local M = {}
local namespace = nil

local function git_root()
  local lines = vim.fn.systemlist({ "git", "rev-parse", "--show-toplevel" })
  if vim.v.shell_error ~= 0 or lines[1] == nil or lines[1] == "" then
    return vim.fn.getcwd()
  end
  return lines[1]
end

local function handshake(repo_root)
  return {
    clientName = "smartmerge",
    clientVersion = "0.0.0",
    protocolRange = "1.0.0",
    repoRoot = repo_root,
    workspaceTrusted = true,
    capabilities = { supportsWebview = false, supportsDiagnostics = false },
  }
end

local function open(repo_root)
  local client = rpc.connect(repo_root)
  client.request("initialize", handshake(repo_root))
  return client
end

local function candidate_for(proposal)
  if proposal.recommended == nil then
    return nil
  end
  for _, candidate in ipairs(proposal.candidates or {}) do
    if candidate.id == proposal.recommended then
      return candidate
    end
  end
  return nil
end

local function recommendation_text(proposal)
  local candidate = candidate_for(proposal)
  if candidate == nil then
    return "No recommendation yet"
  end
  return tostring(proposal.recommended) .. " " .. tostring(candidate.confidence)
end

local function safe_accept(proposal)
  local candidate = candidate_for(proposal)
  if candidate == nil or candidate.hazardous == true then
    return nil
  end
  return {
    type = "accept",
    hunkId = proposal.hunkId,
    candidateId = candidate.id,
  }
end

local function hunk_for(file, hunk_id)
  for _, hunk in ipairs(file.hunks or {}) do
    if hunk.id == hunk_id then
      return hunk
    end
  end
  return nil
end

local function mark(repo_root, file, proposal)
  local hunk = hunk_for(file, proposal.hunkId)
  if hunk == nil or hunk.range == nil then
    return
  end
  if namespace == nil then
    namespace = vim.api.nvim_create_namespace("smartmerge")
  end
  local absolute = vim.fs.joinpath(repo_root, file.path)
  local bufnr = vim.fn.bufnr(absolute)
  if bufnr == -1 then
    bufnr = vim.fn.bufadd(absolute)
  end
  vim.api.nvim_buf_set_extmark(bufnr, namespace, hunk.range.startLine - 1, 0, {
    end_row = hunk.range.endLine,
    end_col = 0,
    virt_text = { { recommendation_text(proposal), "Comment" } },
    virt_text_pos = "eol",
  })
end

function M.resolve()
  local repo_root = git_root()
  local client = open(repo_root)
  local session = client.request("conflicts/list", { repoRoot = repo_root })
  for _, row in ipairs(session.files or {}) do
    local proposals = client.request("resolution/propose", {
      sessionId = session.sessionId,
      path = row.file.path,
    })
    if namespace ~= nil then
      local bufnr = vim.fn.bufnr(vim.fs.joinpath(repo_root, row.file.path))
      if bufnr ~= -1 then
        vim.api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)
      end
    end
    for _, proposal in ipairs(proposals or {}) do
      mark(repo_root, row.file, proposal)
      local action = safe_accept(proposal)
      if action ~= nil then
        client.request("resolution/act", {
          sessionId = session.sessionId,
          action = action,
        })
      end
    end
  end
end

function M.accept_all()
  local repo_root = git_root()
  local client = open(repo_root)
  local session = client.request("conflicts/list", { repoRoot = repo_root })
  client.request("resolution/act", {
    sessionId = session.sessionId,
    action = { type = "applyAllSafe", minBand = "certain" },
  })
end

return M
