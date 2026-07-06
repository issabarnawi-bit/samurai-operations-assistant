export function parseOrders() {
    const orders = [];

    document.querySelectorAll("article").forEach(article => {

        const id = article.querySelector("header span")?.textContent.trim();

        const links = article.querySelectorAll("header a");
        const store = links[1]?.textContent.trim();

        const paragraphs = article.querySelectorAll("p");

        orders.push({
            id,
            store,
            type: paragraphs[0]?.textContent.trim(),
            details: paragraphs[1]?.textContent.trim()
        });
    });

    return orders;
}