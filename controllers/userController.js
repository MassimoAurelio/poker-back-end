const User = require("../models/modelUser");

const suits = ["♥", "♠", "♦", "♣"];
const values = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];
/* const playerCards = []; */
/* const flopCards = []; */

// Функция для перемешивания карт в колоде
function shuffleDeck() {
  const deck = [];
  suits.forEach((suit) => {
    values.forEach((value) => {
      deck.push({ value, suit });
    });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Функция для раздачи двух карт каждому игроку
function dealCards(deck, players) {
  const playerCards = [];
  for (let i = 0; i < players.length; i++) {
    const cards = [deck.pop(), deck.pop()];
    playerCards.push({ playerId: players[i]._id, cards });
  }
  return playerCards;
}

// Функция для раздачи трех карт (флопа)
function dealFlopCards() {
  const flopCards = [];
  const deck = shuffleDeck();
  for (let i = 0; i < 5; i++) {
    flopCards.push(deck.pop());
  }
  return flopCards;
}

//Выдача флопа
exports.dealFlopCards = async (req, res) => {
  try {
    const flopCards = dealFlopCards(); // Функция, которая раздаст три карты
    res.status(200).json({ flopCards });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Раздача карт игрокам
exports.deal = async (req, res) => {
  try {
    const players = await User.find({});
    const deck = shuffleDeck();
    const playerCards = dealCards(deck, players);
    await Promise.all(
      playerCards.map(async (playerCard) => {
        await User.updateOne(
          { _id: playerCard.playerId },
          { $set: { cards: playerCard.cards } }
        );
      })
    );
    res.status(200).json("Карты успешно разданы");
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Сесть за стол
exports.join = async (req, res) => {
  const { player, position, stack } = req.body;
  try {
    const existingPlayer = await User.findOne({ name: player });
    if (existingPlayer) {
      return res.status(400).json("Такой игрок уже сидит за столом");
    }

    const positionPlayer = await User.findOne({ position: position });
    if (positionPlayer) {
      return res.status(400).json("Это место на столе уже занято");
    }

    const newPlayer = new User({ name: player, position, stack });
    await newPlayer.save();

    if (position === 1) {
      await User.updateOne(
        { _id: newPlayer._id },
        { $inc: { stack: -25 }, $set: { lastBet: 25 } }
      );
    } else if (position === 2) {
      await User.updateOne(
        { _id: newPlayer._id },
        { $inc: { stack: -50 }, $set: { lastBet: 50 } }
      );
    }

    if (position === 3) {
      await User.updateMany(
        { position: 3 },
        { $set: { currentPlayerId: true } }
      );
    }

    res
      .status(200)
      .json(`Игрок ${player} присоединился к столу на позицию ${position}.`);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Встать из стола
exports.leave = async (req, res) => {
  const player = req.body.position;
  try {
    await User.findOneAndDelete({ position: player });
    res.status(200).send(`Игрок ${player} покинул стол.`);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ошибка при удалении игрока", error: error.message });
  }
};

//Информация о столе
exports.getPlayers = async (req, res) => {
  try {
    const players = await User.find({});
    res.status(200).json(players);
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при получении списка игроков",
      error: error.message,
    });
  }
};

// Обновление позиций
exports.updatePositions = async (req, res) => {
  try {
    const players = await User.find({ fold: false });

    await User.updateOne({ position: 3 }, { $set: { currentPlayerId: false } });

    for (let player of players) {
      player.position = player.position === 1 ? 6 : player.position - 1;
      await player.save();
    }

    await User.updateOne({ position: 3 }, { $set: { currentPlayerId: true } });


    res.status(200).json("Позиции игроков успешно обновлены.");
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при обновлении позиций игроков",
      error: error.message,
    });
  }
};

//Вычитание малого и большого блаинда у первых двух позиций
exports.mbBB = async (req, res) => {
  try {
    const mbBet = await User.updateOne(
      { position: 1 },
      { $inc: { stack: -25 } }
    );
    const bBBet = await User.updateOne(
      { position: 2 },
      { $inc: { stack: -50 } }
    );

    res.status(200).json({
      message: `Малый ${mbBet.stack} и большой блаинд ${bBBet.stack} высчитались из первой и второй позиции`,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



//Поднимаем ставку
exports.raise = async (req, res) => {
  try {
    const { name, raiseAmount } = req.body;

    const player = await User.findOne({ name });

    if (!player) {
      return res.status(404).json(`Игрок ${name} не найден`);
    }

    if (player.stack < raiseAmount) {
      return res
        .status(400)
        .json({ message: "Недостаточно средств для рейза" });
    }

    const lastBigBetUser = await User.findOne({}).sort({ lastBet: -1 });

    if (raiseAmount < lastBigBetUser.lastBet) {
      return res
        .status(400)
        .json({ message: "Нельзя повысить на сумму меньше прошлого рейза" });
    }

    let sum = parseInt(raiseAmount) + parseInt(player.lastBet);

    await User.updateOne(
      { name },
      {
        $inc: { stack: -raiseAmount },
        $set: { lastBet: sum },
      }
    );

    res.status(200).json({ message: "Ставка рейза успешно выполнена" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Сбрасываем карты
exports.fold = async (req, res) => {
  try {
    const { name } = req.body;

    const player = await User.findOne({ name });

    if (!player) {
      return res.status(404).json({ message: "Игрок не найден" });
    }

    await User.updateOne({ _id: player._id }, { fold: true });

    res.status(200).json({ message: `Игрок ${name} пропустил ход` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.check = async (req, res) => {
  try {
    const { name } = req.body;
    const player = await User.findOne({ name });
    if (!player) {
      return res.status(404).json({ message: `Игрок ${name} не найден` });
    }
    const lastBigBetUser = await User.findOne({}).sort({ lastBet: -1 });

    if (lastBigBetUser.lastBet !== player.lastBet) {
      return res.status(404).json({ message: `Невозможно сделать чек` });
    }

    res.status(200).json({ message: `Игрок ${player.name} сделал чек` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Коллируем самую большую ставку до нас
exports.coll = async (req, res) => {
  try {
    const { name } = req.body;

    const player = await User.findOne({ name });

    if (!player) {
      return res.status(404).json({ message: "Юзер не найден" });
    }

    const lastBigBetUser = await User.findOne({}).sort({ lastBet: -1 });

    if (!lastBigBetUser) {
      return res
        .status(404)
        .json({ message: "Последняя самая большая ставка не найдена" });
    }

    if (player.stack < lastBigBetUser.lastBet - player.lastBet) {
      return res.status(400).json({
        message: `У ${player.name} не достаточно фишек для этого колла`,
      });
    }

    if (lastBigBetUser.lastBet === player.lastBet) {
      return res.status(200).json("Игрок уже уровнял самую большую ставку");
    }

    let lastBetU = lastBigBetUser.lastBet - player.lastBet;

    await User.updateOne(
      { _id: player._id },
      {
        $inc: { stack: -lastBetU },
        $set: { lastBet: lastBigBetUser.lastBet },
      }
    );

    res.status(200).json("OK");
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//Передача хода следующему игроку
exports.nextTurnPlayer = async (req, res) => {
  try {
    const currentTurn = await User.findOne({ currentPlayerId: true });

    if (!currentTurn) {
      return res.status(404).json({ message: "Текущий игрок не найден" });
    }

    await User.updateOne({ _id: currentTurn._id }, { currentPlayerId: false });

    let nextTurn;

    if (currentTurn.position === 6) {
      nextTurn = await User.findOne({
        position: 1,
        currentPlayerId: false,
        fold: false,
      });
    } else {
      nextTurn = await User.findOne({
        position: { $gt: currentTurn.position },
        currentPlayerId: false,
        fold: false,
      });
    }

    if (!nextTurn) {
      return res.status(404).json({ message: "Следующий игрок не найден" });
    }

    await User.updateOne({ _id: nextTurn._id }, { currentPlayerId: true });

    res.status(200).json({
      message: `Ход передан следующему игроку ${currentTurn.name}`,
      nextPlayer: nextTurn,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
