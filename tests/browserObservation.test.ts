import {
  browserObservationRequestEvent,
  publishBrowserObservation,
  requestBrowserObservation,
  resolveBrowserObservationUrl,
} from "../src/services/browserRuntime/browserObservation";

describe("browser observation bridge", () => {
  it("returns extracted browser text to the requesting chat flow", async () => {
    const requestHandler = (event: Event) => {
      const { requestId, url } = (event as CustomEvent<{ requestId: string; url: string }>).detail;
      publishBrowserObservation({ requestId, url, text: "Centerton, Arkansas: 78 F and clear." });
    };
    window.addEventListener(browserObservationRequestEvent, requestHandler);

    await expect(requestBrowserObservation("http://wttr.in/Centerton")).resolves.toMatchObject({
      url: "http://wttr.in/Centerton",
      text: "Centerton, Arkansas: 78 F and clear.",
    });

    window.removeEventListener(browserObservationRequestEvent, requestHandler);
  });

  it("routes a weather shortcut to the location named by the user", () => {
    expect(resolveBrowserObservationUrl("How's the weather for Centerton, Arkansas?", "http://wttr.in")).toBe(
      "http://wttr.in/Centerton%2C%20Arkansas",
    );
  });
});
