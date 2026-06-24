/**
 * 将 shell 风格命令字符串解析为 argv（不展开变量、不启动 shell）。
 * 支持单引号、双引号与反斜杠转义（双引号内）。
 *
 * @param {string} command
 * @returns {string[]}
 */
export function parseShellCommand(command) {
  /** @type {string[]} */
  const args = []
  let current = ''
  /** @type {"'" | '"' | null} */
  let quote = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]

    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
      continue
    }

    if (quote === '"') {
      if (char === '\\' && index + 1 < command.length) {
        current += command[index + 1]
        index += 1
        continue
      }
      if (char === '"') {
        quote = null
        continue
      }
      current += char
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (quote) {
    throw new Error(`[shell-command] unclosed quote in command: ${command}`)
  }
  if (current) args.push(current)
  if (args.length === 0) {
    throw new Error(`[shell-command] empty command: ${command}`)
  }

  return args
}

/**
 * @param {string} command
 * @returns {{ bin: string, args: string[] }}
 */
export function splitShellCommand(command) {
  const argv = parseShellCommand(command)
  const [bin, ...args] = argv
  return { bin, args }
}
