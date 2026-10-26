-- wrk workload. WORKLOAD env: feed | post | like | create | mixed (load.js ratios:
-- 46.1% feed, 46.1% post, 6.9% like, 0.9% create). TOKENS env: path to seed/tokens.json.
local workload = os.getenv("WORKLOAD") or "mixed"
local tokens = {}
local counter = 0

function init(args)
  local f = io.open(os.getenv("TOKENS") or "tokens.json")
  local text = f:read("*a"); f:close()
  for t in text:gmatch('"token"%s*:%s*"([^"]+)"') do tokens[#tokens + 1] = t end
  math.randomseed(os.time() + (tonumber(tostring({}):match("0x(%x+)"), 16) or 0))
end

local function auth()
  return { ["Authorization"] = "Bearer " .. tokens[math.random(#tokens)], ["Content-Type"] = "application/json" }
end

local function feed() return wrk.format("GET", "/feed") end
local post_max = tonumber(os.getenv("POST_MAX") or "500000")
local function post() return wrk.format("GET", "/posts/" .. math.random(post_max - 5000, post_max)) end
local function like()
  return wrk.format("POST", "/posts/" .. math.random(1, post_max) .. "/like", auth(), "")
end
local function create()
  counter = counter + 1
  return wrk.format("POST", "/posts", auth(), '{"body":"wrk says hi at ' .. os.time() .. ' (' .. counter .. ')"}')
end

function request()
  if workload == "feed" then return feed()
  elseif workload == "post" then return post()
  elseif workload == "like" then return like()
  elseif workload == "create" then return create() end
  local r = math.random()
  if r < 0.461 then return feed()
  elseif r < 0.922 then return post()
  elseif r < 0.991 then return like()
  else return create() end
end
