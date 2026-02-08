function formatGroupInfo(
    groupInfo: {group_all_shut: number; group_remark: string; group_id: number; group_name: string; member_count: number; max_member_count: number;}, 
    ): string {
    return `
群名: ${groupInfo.group_name} (ID: ${groupInfo.group_id})
群备注: ${groupInfo.group_remark || "无"}
成员数: ${groupInfo.member_count}\n`;
}

function formatGroupMemberList(
    memberInfo: {user_id: number; nickname: string; title: string;}[]
): string {
    let str = `\n成员列表: [昵称 (id) - 群内昵称]\n`;
    str += memberInfo.map((m) => `${m.nickname} (${m.user_id}) - ${m.title}`).join("\n");
    str += "\n";
    return str
}

export { formatGroupInfo, formatGroupMemberList }