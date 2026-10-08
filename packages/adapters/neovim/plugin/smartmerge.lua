if vim.g.loaded_smartmerge then
  return
end
vim.g.loaded_smartmerge = true

vim.api.nvim_create_user_command("SmartMergeResolve", function()
  require("smartmerge").resolve()
end, {})

vim.api.nvim_create_user_command("SmartMergeAcceptAll", function()
  require("smartmerge").accept_all()
end, {})
