/**
 * 极简 argv 解析。只支持 `--flag`、`--key value`、`--key=value`，够发版用。
 */

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {Map<string, string[]>} */
  const values = new Map()
  /** @type {Set<string>} */
  const flags = new Set()
  /** @type {string[]} */
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const eq = token.indexOf('=')
    if (eq !== -1) {
      push(values, token.slice(2, eq), token.slice(eq + 1))
      continue
    }

    const name = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      flags.add(name)
      continue
    }
    push(values, name, next)
    index += 1
  }

  return {
    positional,
    /** @param {string} name */
    has(name) {
      return flags.has(name) || values.has(name)
    },
    /** @param {string} name @param {string} [fallback] */
    get(name, fallback = '') {
      const list = values.get(name)
      return list?.[list.length - 1] ?? fallback
    },
    /** 同名参数可重复传，也可逗号分隔。 @param {string} name */
    list(name) {
      const list = values.get(name) ?? []
      return list
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    },
  }
}

/** @typedef {ReturnType<typeof parseArgs>} Args */

/**
 * @param {Map<string, string[]>} map
 * @param {string} key
 * @param {string} value
 */
function push(map, key, value) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
