local M = {}

local function content_length(header)
  return tonumber(header:match("[Cc]ontent%-[Ll]ength:%s*(%d+)"))
end

--- Speak Content-Length JSON-RPC to `smartmerged --stdio`.
--- The body is one JSON-RPC object. This module does not merge text.
function M.connect(repo_root)
  local state = {
    buffer = "",
    next_id = 1,
    pending = {},
    system = nil,
  }

  local function consume()
    while true do
      local header_end = string.find(state.buffer, "\r\n\r\n", 1, true)
      if header_end == nil then
        return
      end
      local header = string.sub(state.buffer, 1, header_end - 1)
      local length = content_length(header)
      if length == nil then
        return
      end
      local body_start = header_end + 4
      local body_end = body_start + length - 1
      if #state.buffer < body_end then
        return
      end
      local body = string.sub(state.buffer, body_start, body_end)
      state.buffer = string.sub(state.buffer, body_end + 1)
      local ok, decoded = pcall(vim.json.decode, body)
      if ok and type(decoded) == "table" and decoded.id ~= nil then
        local callback = state.pending[decoded.id]
        if callback ~= nil then
          state.pending[decoded.id] = nil
          callback(decoded)
        end
      end
    end
  end

  state.system = vim.system({ "smartmerged", "--stdio" }, {
    cwd = repo_root,
    stdin = true,
    stdout = function(_, data)
      if type(data) == "string" and data ~= "" then
        state.buffer = state.buffer .. data
        consume()
      end
    end,
  })

  function state.request(method, params)
    local id = state.next_id
    state.next_id = id + 1
    local body = vim.json.encode({
      jsonrpc = "2.0",
      id = id,
      method = method,
      params = params,
    })
    local message = "Content-Length: " .. tostring(#body) .. "\r\n\r\n" .. body
    local received = nil
    state.pending[id] = function(decoded)
      received = decoded
    end
    state.system:write(message)
    vim.wait(10000, function()
      return received ~= nil
    end, 20)
    if received == nil then
      error("daemon request timed out: " .. method)
    end
    if received.error ~= nil then
      local text = received.error.message
      if type(text) ~= "string" then
        text = method .. " failed"
      end
      error(text)
    end
    return received.result
  end

  return state
end

return M
