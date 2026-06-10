import json

LOC = "D7EZ98V48F79A"
CH  = "CH_LZFwauq800rq6X5QiLiEuTK4PSd64QIgxX4JwBHe9945o"
SIZES = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5]

def size_label(s):
    return str(int(s)) if s == int(s) else str(s)

def new_var(item_id, temp_id, name, ordinal, price):
    return {
        "type": "ITEM_VARIATION", "id": temp_id,
        "present_at_all_locations": False, "present_at_location_ids": [LOC],
        "item_variation_data": {
            "item_id": item_id, "name": name, "ordinal": ordinal,
            "pricing_type": "FIXED_PRICING",
            "price_money": {"amount": price, "currency": "USD"},
            "track_inventory": True, "sellable": True, "stockable": True, "channels": [CH]
        }
    }

def existing_var(item_id, var_id, var_version, v1_id, name, ordinal, price):
    return {
        "type": "ITEM_VARIATION", "id": var_id, "version": var_version,
        "present_at_all_locations": False, "present_at_location_ids": [LOC],
        "catalog_v1_ids": [{"catalog_v1_id": v1_id, "location_id": LOC}],
        "item_variation_data": {
            "item_id": item_id, "name": name, "ordinal": ordinal,
            "pricing_type": "FIXED_PRICING",
            "price_money": {"amount": price, "currency": "USD"},
            "track_inventory": True, "sellable": True, "stockable": True, "channels": [CH]
        }
    }

singles = [
    {"item_id": "JPKZTGB7TTBH3M2XOZQN3KNQ", "item_version": 1777129011026,
     "name": "Tri-Color Meditation RIng", "abbr": "Tr",
     "v1": "5410acae-380b-4c28-80b8-0a1c0430f09b",
     "var_id": "F2DJKMHQ75RDE6YUSXVV3I23", "var_version": 1754164075380,
     "var_v1": "43802b1c-2eb3-43fe-86e5-6da4eee39277", "price": 11500, "prefix": "tc",
     "cats": [{"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251748274077696}],
     "rep_cat": {"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251748274077696},
     "mods": [
         {"modifier_list_id": "NJJHATDQ4TLUJVU7KYBZXHI4", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 0},
         {"modifier_list_id": "UVRFVQLKJEMKPULN6PCPNF6D", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 2},
         {"modifier_list_id": "M2J4XOZD5WNNBNAXHSUIBAFT", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "hidden_from_customer": False, "ordinal": 4}]},
    {"item_id": "BBG3TAR6DZH5S5OSZX3PDN2A", "item_version": 1777129012477,
     "name": "Open Bodhi Meditation Ring", "abbr": None,
     "v1": "806fa50c-c1bb-4157-84d3-e44694bd2ee7",
     "var_id": "RHS6ELWMXHWMTF7FINCV5HCI", "var_version": 1754164076091,
     "var_v1": "67948cb3-e4ce-4abe-a798-feb3d4b5c8f0", "price": 10000, "prefix": "ob",
     "cats": [{"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251739684143104}],
     "rep_cat": {"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251739684143104},
     "mods": [
         {"modifier_list_id": "VD2ORBUXDSSLTELEGDB6T5PF", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 0},
         {"modifier_list_id": "M2J4XOZD5WNNBNAXHSUIBAFT", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "hidden_from_customer": False, "ordinal": 2}]},
    {"item_id": "ZXMKBLUGN4XEETBT5MJMIWX2", "item_version": 1777129016596,
     "name": "Orbit Meditation Ring", "abbr": "Or",
     "v1": "ba1b9696-d43a-457b-adf4-6bee1607f30a",
     "var_id": "L2UYHVZ4WREZ4BB43JFYPM5D", "var_version": 1754164078004,
     "var_v1": "3d5c0630-d077-4ae7-a1c9-b76be21e502a", "price": 9500, "prefix": "or",
     "cats": [{"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251765453946880}],
     "rep_cat": {"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251765453946880},
     "mods": [
         {"modifier_list_id": "TU2BWSM6N7C2XYGMKOEFYUVJ", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 0},
         {"modifier_list_id": "NJJHATDQ4TLUJVU7KYBZXHI4", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 1},
         {"modifier_list_id": "HOAWH5QC6JEIFPA4QG5AU5RV", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 4},
         {"modifier_list_id": "M2J4XOZD5WNNBNAXHSUIBAFT", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "hidden_from_customer": False, "ordinal": 6}]},
    {"item_id": "GBIWWIRD244G67PDWFVJBHIP", "item_version": 1777129024654,
     "name": "Bodhi Meditation Ring", "abbr": "Bo",
     "v1": "12884cf4-abe3-40a1-a83c-c21e79d2d764",
     "var_id": "N3LWLXV22S5UST65SSKEOTJ2", "var_version": 1754164081838,
     "var_v1": "88d42793-1ee5-4c84-805d-596c8c33287c", "price": 9000, "prefix": "bm",
     "cats": [{"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251799813685248}],
     "rep_cat": {"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251799813685248},
     "mods": [
         {"modifier_list_id": "NJJHATDQ4TLUJVU7KYBZXHI4", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 0},
         {"modifier_list_id": "O7OWEAE3T4PAJVEEFVPGPBMQ", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "ordinal": 2},
         {"modifier_list_id": "M2J4XOZD5WNNBNAXHSUIBAFT", "min_selected_modifiers": -1, "max_selected_modifiers": -1, "enabled": True, "hidden_from_customer": False, "ordinal": 4}]},
]

objects = []
for item in singles:
    variations = []
    for i, s in enumerate(SIZES):
        label = "Size " + size_label(s)
        if i == 0:
            variations.append(existing_var(item["item_id"], item["var_id"], item["var_version"], item["var_v1"], label, i, item["price"]))
        else:
            variations.append(new_var(item["item_id"], "#" + item["prefix"] + "-" + size_label(s).replace(".", "_"), label, i, item["price"]))
    obj = {
        "type": "ITEM", "id": item["item_id"], "version": item["item_version"],
        "present_at_all_locations": False, "present_at_location_ids": [LOC],
        "catalog_v1_ids": [{"catalog_v1_id": item["v1"], "location_id": LOC}],
        "item_data": {
            "name": item["name"], "is_taxable": True,
            "tax_ids": ["ODPRJC43LTKGUC2CXYKCO7OM"],
            "modifier_list_info": item["mods"], "variations": variations,
            "categories": item["cats"], "reporting_category": item["rep_cat"],
            "product_type": "REGULAR", "channels": [CH]
        }
    }
    if item["abbr"]:
        obj["item_data"]["abbreviation"] = item["abbr"]
    objects.append(obj)

# Slim
slim_id = "H6FEHZNI5RHJL45BYZHZXM23"
slim_vars = []
for i, s in enumerate(SIZES):
    lbl = size_label(s)
    sfx = lbl.replace(".", "_")
    if i == 0:
        slim_vars.append(existing_var(slim_id, "34SM7HPRNBOGI3T4PQT542JD", 1762711240872, "5BPZXMHILUFDNKLJ6W72OBNJ", "Silver - " + lbl, 0, 8500))
        slim_vars.append(existing_var(slim_id, "YS2HLZRCUZ56BQ3OUIN7TURQ",  1762711229742, "C3ZBFCNZJICUGLRHIGXKTYUE", "Gold Fill - " + lbl, 1, 9500))
    else:
        slim_vars.append(new_var(slim_id, "#sm-s-" + sfx, "Silver - " + lbl, i*2,   8500))
        slim_vars.append(new_var(slim_id, "#sm-g-" + sfx, "Gold Fill - " + lbl, i*2+1, 9500))

objects.append({
    "type": "ITEM", "id": slim_id, "version": 1777129056649,
    "present_at_all_locations": False, "present_at_location_ids": [LOC],
    "catalog_v1_ids": [{"catalog_v1_id": "ONUCZ2HF5TSHUKD3BLBLP4DJ", "location_id": LOC}],
    "item_data": {
        "name": "Slim Meditation Ring", "is_taxable": True,
        "tax_ids": ["ODPRJC43LTKGUC2CXYKCO7OM"],
        "variations": slim_vars,
        "categories": [
            {"id": "KCBQ7S6OOBEATCBNCH4IWSZ5", "ordinal": -2250975179964416},
            {"id": "A6V47F3AH7YYNTSXD7NA67PZ", "ordinal": -2251670964666368}
        ],
        "reporting_category": {"id": "KCBQ7S6OOBEATCBNCH4IWSZ5", "ordinal": -2250975179964416},
        "product_type": "REGULAR", "channels": [CH]
    }
})

print(json.dumps({"idempotency_key": "med-rings-sizes-20260609a", "batches": [{"objects": objects}]}))
