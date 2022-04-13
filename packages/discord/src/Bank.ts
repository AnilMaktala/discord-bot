import * as path from 'node:path'
import glob from 'fast-glob'
import { ApplicationCommandManager } from 'discord.js'
import { DiscordCommand } from './Command.js'
import { createDiscordApi, DiscordApi } from './api.js'
import { generateResponse } from './support.js'
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord-api-types/v10'
import type { CommandInteraction } from 'discord.js'

export class DiscordCommandMap extends Map<string, DiscordCommand> {
  constructor(commands: DiscordCommand[]) {
    super()
    return new Map(commands.map((command) => [command.name, command]))
  }
}

export interface IDiscordCommandBank extends DiscordCommandMap {
  handle(context): Promise<string>
  register(
    command: RESTPostAPIApplicationCommandsJSONBody,
    context: any
  ): Promise<any>
  unregister(commandId: any, { guildId }): Promise<any>
  list(): Promise<any>
  sync(): Promise<any>
}

export class DiscordCommandBank
  extends DiscordCommandMap
  implements IDiscordCommandBank
{
  private api = createDiscordApi()

  constructor(commands: DiscordCommand[]) {
    super(commands)
    // needed when extending native types
    Object.setPrototypeOf(this, new.target.prototype)
  }

  public async register(
    commandConfig: RESTPostAPIApplicationCommandsJSONBody,
    { guildId } = { guildId: null }
  ) {
    let url = `/applications/${process.env.DISCORD_APP_ID}`
    if (guildId) {
      url += `/guilds/${guildId}`
    }
    url += '/commands'

    // RESTPostAPIApplicationCommandsResult
    // TODO: add whether command was added or updated based on status
    return this.api.post(url as `/${string}`, commandConfig as any)
  }

  public async unregister(commandId, { guildId }): Promise<any> {
    let url = `/applications/${process.env.DISCORD_APP_ID}`
    if (guildId) {
      url += `/guilds/${guildId}`
    }
    url += `/commands/${commandId}`

    return this.api.delete(url as `/${string}`)
  }

  public async sync() {
    const result = [] as any
    for (const command of this.values()) {
      let registered
      try {
        registered = (await this.register(
          command.createRegistrationPayload()
        )) as any[]
      } catch (error) {
        console.error(`Error registering command ${command.name}:`, error)
      }
      if (registered) result.push(registered)
    }
    if (!result.length) {
      throw new Error('No commands registered')
    }
    return result
  }

  public async list() {
    const registeredCommands = (await this.api.get(
      `/applications/${process.env.DISCORD_APP_ID}/commands`
    )) as any[]

    const banked = Array.from(this.values())
    const commands = [] as any
    for (const command of banked) {
      const registered = registeredCommands?.find(
        (c) => c.name === command.name
      )
      if (registered) {
        command.registration = registered
      }
      commands.push(command)
    }
    return commands
  }

  public async handle(interaction: CommandInteraction) {
    const somethingWentWrongResponse = '🤕 Something went wrong'
    const command = this.get(interaction.commandName)
    if (!command)
      throw new Error(`Invalid slash command: ${interaction.commandName}`)

    let commandResponse
    try {
      commandResponse = await command.handler(interaction)
    } catch (error) {
      console.error(`Error executing command "${command?.name}"`, error)
    }

    let toRespond = commandResponse ?? somethingWentWrongResponse
    if (typeof toRespond === 'string') {
      toRespond = generateResponse(toRespond)
    }

    return toRespond
  }
}

function createDiscordCommandBank(
  commands: DiscordCommand[]
): DiscordCommandBank {
  return new DiscordCommandBank(commands)
}

export async function createBank(commandDirectories: string[] | string) {
  // TODO: add support for other command dirs
  const builtinCommandsDirectory = new URL('commands', import.meta.url).pathname
  const providedCommandDirectories = Array.isArray(commandDirectories)
    ? commandDirectories
    : [commandDirectories]
  const commandGlobPattern = '!(_*|*.d).(js|ts)'
  const commandPathsGlob = [
    builtinCommandsDirectory,
    providedCommandDirectories,
  ].map((path) => `${path}/${commandGlobPattern}`)

  const commandPaths = await glob(commandPathsGlob, {
    onlyFiles: true,
    absolute: true,
  })

  const commands: any[] = [] // TODO: type
  for (const commandPath of commandPaths) {
    let command
    let mod
    try {
      mod = await import(commandPath)
    } catch (error) {
      throw new Error(`Error importing ${commandPath}: ${error}`)
    }
    if (!mod?.default) command = mod
    else command = mod.default
    if (command instanceof DiscordCommand) {
      commands.push(command)
    } else {
      console.warn(
        `Command: ${path.basename(
          commandPath
        )} does not export a DiscordCommand, skipping...`
      )
    }
  }

  return createDiscordCommandBank(commands)
}
