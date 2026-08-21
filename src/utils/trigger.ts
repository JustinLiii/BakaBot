/**
 * 基于规则的触发器，主要针对直接提及bot和提问进行处理。在一次触发消息后线性衰减回复概率
 * 部分参考 MaiBot 的触发思路(https://github.com/Mai-with-u/MaiBot/blob/5f871ca3f23b7f2427da65d1e6423aac0de07a19/src/maisaka/reply_necessity.py)
 */
const baseReplyPossibility = 0.01;
// TODO 在接入图片消息处理和多模态之后实装
const imageReplyPossibility = 0.0; // 考虑到群友喜欢发梗图，单独图片消息应该得到更高触发概率
const replyPossibilityDecay = 0.1;
const indefiniteQuestionReplyPossibilityDelta = 0.3;
const selfReferenceReplyPossibility = 0.6;
const atMeReplyPossibility = 1.0;
const selfReferenceTerms = ["水无书"]; // TODO: 可配置名字
const indefiniteReferenceTerms = ["大家", "有人", "有没有人", "群友", "各位", "朋友们", "同志们"];
const requestTerms = ["帮我", "帮忙", "能不能", "可以吗", "要不要", "需要", "求", "看看", "试试"];
const questionTerms = ["怎么", "如何", "为什么", "有没有", "啥", "什么", "哪", "呢", "？", "?"];
const questionAvoidTerms = ["那什么", "这什么", "没什么", "不怎么", "那啥"];

class ReplyTrigger {
    replyPossibility = baseReplyPossibility;
    constructor() {
        this.replyPossibility = baseReplyPossibility;
    }

    public resetTrigger(): void {
        this.replyPossibility = baseReplyPossibility;
    }

    public newMsg(text: string, atMe: boolean, image: boolean): boolean {
        if (atMe) {
            this.replyPossibility = atMeReplyPossibility;
        } else if (this.isReferSelf(text)) {
            this.replyPossibility = selfReferenceReplyPossibility;
        } else if ((this.isRequest(text) || this.isQuestion(text)) && this.isIndefiniteRefer(text)) {
            this.replyPossibility += indefiniteQuestionReplyPossibilityDelta;
        } else {
            this.replyPossibility -= replyPossibilityDecay;
        }

        this.replyPossibility = Math.min(1.0, Math.max(baseReplyPossibility, this.replyPossibility));

        if (Math.random() < this.replyPossibility) {
            return true;
        } else {
            return false;
        }
    }

    private isReferSelf(text: string): boolean {
        if (selfReferenceTerms.some((term) => text.includes(term))) {
            return true;
        } else {
            return false;
        }
    }

    private isIndefiniteRefer(text: string): boolean {
        if (indefiniteReferenceTerms.some((term) => text.includes(term))) {
            return true;
        } else {
            return false;
        }
    }

    private isQuestion(text: string): boolean {
        questionAvoidTerms.forEach(term => {
            text.replaceAll(term, "")
        });
        if (questionTerms.some((term) => text.includes(term))) {
            return true;
        } else {
            return false;
        }
    }

    private isRequest(text: string): boolean {
    if (requestTerms.some((term) => text.includes(term))) {
            return true;
        } else {
            return false;
        }
    }
}

export { ReplyTrigger }