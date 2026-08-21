import { napcat } from "./src/qqbot/napcat";
import { BakaBot } from "./src/bakabot";

await napcat.connect();

const info = await napcat.get_login_info()

const bot = new BakaBot(napcat, info.user_id.toString());

napcat.on("message", (event) => bot.onMsg(event));


