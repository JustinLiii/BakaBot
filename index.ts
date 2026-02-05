import { napcat } from "./src/napcat";
import { BakaBot } from "./src/bakabot";

await napcat.connect();

const info = await napcat.get_login_info()

const bot = new BakaBot(info.user_id.toString());

napcat.on("message", (event) => bot.onMsg(event, napcat));


