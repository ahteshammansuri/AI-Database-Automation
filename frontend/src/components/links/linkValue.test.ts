import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { blankValue, fitsFamily, humanize, isNewLink, linkSourceText, newLink, valueText } from "./linkValue.ts";
import { thingOf, unlinkedIdColumns } from "../schema/schemaFacts.ts";

describe("linked values", () => {
  test("a new linked row carries its name in the name column and a label to show", () => {
    const v = newLink("Cloud", "category_name");
    assert.deepEqual(v, { $new: { category_name: "Cloud" }, label: "Cloud" });
    assert.equal(isNewLink(v), true);
    assert.deepEqual(newLink("Asha", "name", { email: "a@x.test" }).$new, { email: "a@x.test", name: "Asha" });
    assert.deepEqual(newLink("Old draft", null).$new, {}, "older drafts only know the name");
  });

  test("ids and empty values are not new rows", () => {
    for (const v of [3, "3", null, undefined, "", { id: 3 }]) assert.equal(isNewLink(v), false);
    assert.equal(blankValue(0), false, "0 is a value (not linked), not empty");
    assert.equal(blankValue(""), true);
  });

  test("column names read as words", () => {
    assert.equal(humanize("category_id"), "Category");
    assert.equal(humanize("blog_category_id"), "Blog category");
    assert.equal(humanize("customerId"), "Customer");
    assert.equal(humanize("meta_title"), "Meta title");
    assert.equal(humanize("status"), "Status");
  });

  test("named values and typed values", () => {
    assert.equal(valueText(1, { "1": "Published" }), "Published");
    assert.equal(valueText(2, { "1": "Published" }), "2");
    assert.equal(valueText(null, {}), "");
    assert.equal(fitsFamily("12", "integer"), true);
    assert.equal(fitsFamily("draft", "integer"), false);
    assert.equal(fitsFamily("draft", "string"), true);
    assert.equal(fitsFamily("  ", "string"), false);
    assert.equal(linkSourceText("detected"), "Detected from the name");
  });

  test("schema facts: friendly singulars and columns that look like links", () => {
    assert.equal(thingOf("blog_categories"), "blog category");
    assert.equal(thingOf("addresses"), "address");
    assert.equal(thingOf("users"), "user");
    assert.equal(thingOf("staff"), "staff");
    const table: any = {
      name: "orders",
      columns: [
        { name: "id", is_primary_key: true }, { name: "user_id" }, { name: "guest_id" }, { name: "total" }, { name: "api_token_id", sensitivity: "secret" },
      ],
      relationships: [{ foreign_key: "user_id", referenced_table: "users", referenced_column: "id" }],
    };
    assert.deepEqual(unlinkedIdColumns(table).map((c) => c.name), ["guest_id"]);
  });
});
