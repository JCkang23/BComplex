-- RENTERS table
CREATE TABLE renters (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  preference VARCHAR(20),
  budget NUMERIC(10, 2) DEFAULT 0.00,
  activity_desc TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LANDLORDS table
CREATE TABLE landlords (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rooms_owned INTEGER DEFAULT 0,
  total_income NUMERIC(10, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ROOMS table
CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  room_details TEXT NOT NULL,
  room_type VARCHAR(20),
  room_price NUMERIC(10, 2),
  is_available BOOLEAN DEFAULT TRUE,
  landlord_id INTEGER REFERENCES landlords(id) ON DELETE SET NULL,
  renter_id INTEGER REFERENCES renters(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- RENTERS_ROOMS table
CREATE TABLE renters_rooms (
  id SERIAL PRIMARY KEY,
  renter_id INTEGER REFERENCES renters(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  renter_details TEXT,
  renter_value NUMERIC(10, 2),
  renter_contract_start DATE,
  renter_contract_end DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

/* Coming soon:
-- CONTRACTS table
CREATE TABLE contracts (
  id SERIAL PRIMARY KEY,
  renter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_active_contract UNIQUE (renter_id, room_id, is_active)
);

-- PAYMENTS table
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  renter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  amount NUMERIC(10, 2) NOT NULL,
  status VARCHAR(20) CHECK (status IN ('pending', 'paid', 'failed')) DEFAULT 'pending',
  paid_at TIMESTAMP
);

-- MESSAGES table (for chat)
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
*/