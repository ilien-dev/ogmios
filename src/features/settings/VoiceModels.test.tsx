import { describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMockBackend } from "@/test/mockBackend";
import { VoiceModels } from "./VoiceModels";

describe("VoiceModels", () => {
  useMockBackend(false);

  test("nothing is in use until the learner downloads a model and picks it", async () => {
    const user = userEvent.setup();
    const onSelected = mock();
    render(<VoiceModels onSelected={onSelected} />);

    const [first] = await screen.findAllByRole("listitem");
    if (first === undefined) {
      throw new Error("no models listed");
    }
    expect(screen.queryByText("In use")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this model" })).toBeNull();

    await user.click(within(first).getByRole("button", { name: /Download/u }));
    const use = await within(first).findByRole("button", {
      name: "Use this model",
    });
    expect(screen.queryByText("In use")).toBeNull();
    expect(onSelected).not.toHaveBeenCalled();

    await user.click(use);
    expect(await within(first).findByText("In use")).toBeInTheDocument();
    expect(onSelected).toHaveBeenCalledTimes(1);
  });
});
